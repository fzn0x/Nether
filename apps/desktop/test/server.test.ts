// Talking to a Nether server: addresses as people type them, answers and
// failures, and signing in with a provider through a loopback address.
import { describe, expect, it } from "vitest";
import {
  type LoopbackWait,
  ServerError,
  account,
  pkce,
  request,
  serverAddress,
  signInMethods,
  signInWithProvider,
} from "../src/server.ts";

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** A fetch that answers from a table of routes, and keeps what it was sent. */
function fakeFetch(routes: Readonly<Record<string, (sent: Sent) => Response>>) {
  const sent: Sent[] = [];
  const fetcher = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request: Sent = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    sent.push(request);
    const route = routes[`${request.method} ${new URL(url).pathname}`];
    return route === undefined
      ? Promise.reject(new TypeError("fetch failed"))
      : Promise.resolve(route(request));
  };
  return { fetcher, sent };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const base = "https://nether.example.org";
const user = { id: "u1", name: "Ada", email: "ada@example.org", instanceAdmin: true };

describe("serverAddress", () => {
  it.each([
    ["nether.example.org", "https://nether.example.org"],
    ["  Nether.Example.org/ ", "https://nether.example.org"],
    ["http://10.0.0.2:3000", "http://10.0.0.2:3000"],
    ["https://nether.example.org:8443/", "https://nether.example.org:8443"],
  ])("reads %j as %j", (typed, address) => {
    expect(serverAddress(typed)).toBe(address);
  });

  it.each([
    "",
    "   ",
    "ftp://nether.example.org",
    "https://nether.example.org/app",
    "https://a:b@x.org",
    "https://x.org/?a=1",
    "not an address at all",
  ])("refuses %j", (typed) => {
    expect(serverAddress(typed)).toBeUndefined();
  });
});

describe("request", () => {
  it("sends JSON with the session's token, and gives the server's message on failure", async () => {
    const { fetcher, sent } = fakeFetch({
      "POST /api/things": () => json(403, { statusCode: 403, message: "Not yours." }),
      "DELETE /api/things": () => new Response(null, { status: 204 }),
    });
    const failure = request(fetcher, base, "/api/things", { body: { a: 1 }, token: "t0k" });
    await expect(failure).rejects.toThrow(new ServerError(403, "Not yours."));
    expect(sent[0]).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer t0k", "content-type": "application/json" },
      body: { a: 1 },
    });
    await expect(
      request(fetcher, base, "/api/things", { method: "DELETE", token: "t0k" }),
    ).resolves.toBeUndefined();
  });

  it("says when a server cannot be reached, or does not answer as Nether", async () => {
    const { fetcher } = fakeFetch({
      "GET /api/sign-in-methods": () => json(200, { hello: "world" }),
    });
    await expect(request(fetcher, base, "/api/elsewhere")).rejects.toThrow(
      "https://nether.example.org cannot be reached: fetch failed",
    );
    await expect(signInMethods(fetcher, base)).rejects.toThrow(
      "https://nether.example.org does not answer as a Nether server.",
    );
  });

  it("reads the account and its workspaces, and refuses an answer it cannot read", async () => {
    const { fetcher } = fakeFetch({
      "GET /api/me": () =>
        json(200, {
          user,
          workspaces: [
            { id: "w1", name: "Team", role: "owner", encryption: "none" },
            { id: "w2", name: "Secret", role: "member", encryption: "end-to-end" },
          ],
        }),
    });
    await expect(account(fetcher, base, "t0k")).resolves.toEqual({
      user,
      workspaces: [
        { id: "w1", name: "Team", role: "owner", encrypted: false },
        { id: "w2", name: "Secret", role: "member", encrypted: true },
      ],
    });
    const odd = fakeFetch({ "GET /api/me": () => json(200, { user: { id: 7 } }) });
    await expect(account(odd.fetcher, base, "t0k")).rejects.toThrow(
      "https://nether.example.org gave an answer Nether cannot read.",
    );
  });
});

describe("signing in with a provider", () => {
  function loopback(query: Record<string, string>): LoopbackWait & { closed: boolean } {
    const wait = {
      redirect: "http://127.0.0.1:43123/secret",
      closed: false,
      wait: () => Promise.resolve(query),
      close() {
        wait.closed = true;
        return Promise.resolve();
      },
    };
    return wait;
  }

  it("opens the provider, and redeems the code with the verifier of its challenge", async () => {
    const { fetcher, sent } = fakeFetch({
      "POST /api/oidc/flows": () => json(201, { url: "https://login.example.org/authorize?x=1" }),
      "POST /api/oidc/redeem": () => json(201, { token: "session", expiresAt: "", user }),
    });
    const opened: string[] = [];
    const wait = loopback({ code: "handoff" });
    const signedIn = await signInWithProvider(fetcher, base, wait, (url) => {
      opened.push(url);
      return Promise.resolve();
    });
    expect(signedIn).toEqual({ token: "session", user });
    expect(opened).toEqual(["https://login.example.org/authorize?x=1"]);
    const flow = sent[0]?.body as { redirect: string; challenge: string };
    const redeem = sent[1]?.body as { code: string; verifier: string };
    expect(flow.redirect).toBe("http://127.0.0.1:43123/secret");
    expect(redeem.code).toBe("handoff");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(redeem.verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(flow.challenge).toBe(challenge);
    expect(wait.closed).toBe(true);
  });

  it("says why the provider's sign-in failed, and stops waiting", async () => {
    const { fetcher } = fakeFetch({
      "POST /api/oidc/flows": () => json(201, { url: "https://login.example.org/authorize" }),
    });
    const wait = loopback({ error: "no_account" });
    await expect(signInWithProvider(fetcher, base, wait, () => Promise.resolve())).rejects.toThrow(
      "this server has no account for you",
    );
    expect(wait.closed).toBe(true);
    const odd = loopback({ error: "teapot" });
    await expect(signInWithProvider(fetcher, base, odd, () => Promise.resolve())).rejects.toThrow(
      "Signing in failed: teapot.",
    );
  });

  it("makes a verifier of 43 characters, and a challenge from it", async () => {
    const first = await pkce();
    const second = await pkce();
    expect(first.verifier).toMatch(/^[\w-]{43}$/);
    expect(first.challenge).toMatch(/^[\w-]{43}$/);
    expect(second.verifier).not.toBe(first.verifier);
  });
});
