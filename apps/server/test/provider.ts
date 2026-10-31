// An OpenID Connect provider for tests. Its discovery document, keys and
// token endpoint answer over HTTP, as a real provider's do, and its token
// endpoint checks the client's secret and PKCE. Signing in at it is a call,
// standing in for the browser and the provider's own pages, which signs in
// whoever the test has named, or refuses as a person who cancels.
import { createHash, randomBytes } from "node:crypto";
import { type IncomingMessage, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

export interface Person {
  readonly sub: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
}

interface Grant {
  readonly person: Person;
  readonly nonce: string;
  readonly challenge: string;
  readonly redirect: string;
}

export interface TestProvider {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Who signs in next; none refuses. */
  person: Person | undefined;
  /** Signs in at an authorization address, and gives the address the provider sends the browser back to. */
  authorize(url: string): string;
  close(): Promise<void>;
}

function body(request: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
    request.on("end", () => {
      resolve(new URLSearchParams(text));
    });
    request.on("error", reject);
  });
}

export async function startProvider(): Promise<TestProvider> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const key = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256", use: "sig" };
  const clientId = "nether";
  const clientSecret = randomBytes(16).toString("hex");
  const grants = new Map<string, Grant>();
  let issuer = "";

  async function token(params: URLSearchParams): Promise<[number, object]> {
    if (params.get("client_id") !== clientId || params.get("client_secret") !== clientSecret) {
      return [401, { error: "invalid_client" }];
    }
    const code = params.get("code") ?? "";
    const grant = grants.get(code);
    grants.delete(code);
    const verifier = params.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (grant === undefined) return [400, { error: "invalid_grant" }];
    if (
      params.get("grant_type") !== "authorization_code" ||
      grant.redirect !== params.get("redirect_uri") ||
      grant.challenge !== challenge
    ) {
      return [400, { error: "invalid_grant" }];
    }
    const { sub, ...claims } = grant.person;
    const idToken = await new SignJWT({ ...claims, nonce: grant.nonce })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setIssuer(issuer)
      .setSubject(sub)
      .setAudience(clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return [
      200,
      { access_token: "access", token_type: "Bearer", expires_in: 300, id_token: idToken },
    ];
  }

  const server: Server = createServer((request, response) => {
    const send = ([status, json]: [number, object]) => {
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
    };
    const path = new URL(request.url ?? "/", issuer).pathname;
    if (path === "/.well-known/openid-configuration") {
      send([
        200,
        {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["ES256"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        },
      ]);
    } else if (path === "/jwks") {
      send([200, { keys: [key] }]);
    } else if (path === "/token" && request.method === "POST") {
      void body(request)
        .then(token)
        .then(send, () => {
          send([500, { error: "server_error" }]);
        });
    } else {
      send([404, { error: "not_found" }]);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  const provider: TestProvider = {
    issuer,
    clientId,
    clientSecret,
    person: undefined,
    authorize(url) {
      const asked = new URL(url);
      const params = asked.searchParams;
      if (asked.origin + asked.pathname !== `${issuer}/authorize`) {
        throw new Error(`Not this provider's authorization address: ${url}`);
      }
      if (params.get("client_id") !== clientId || params.get("response_type") !== "code") {
        throw new Error(`Not a request this provider answers: ${url}`);
      }
      if (
        params.get("code_challenge_method") !== "S256" ||
        !params.get("scope")?.includes("openid")
      ) {
        throw new Error(`No PKCE or no openid scope: ${url}`);
      }
      const redirect = params.get("redirect_uri") ?? "";
      const back = new URL(redirect);
      back.searchParams.set("state", params.get("state") ?? "");
      if (provider.person === undefined) {
        back.searchParams.set("error", "access_denied");
        return back.href;
      }
      const code = randomBytes(16).toString("hex");
      grants.set(code, {
        person: provider.person,
        nonce: params.get("nonce") ?? "",
        challenge: params.get("code_challenge") ?? "",
        redirect,
      });
      back.searchParams.set("code", code);
      return back.href;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
  return provider;
}
