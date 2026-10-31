// Signing in with an OpenID Connect provider: the app's flow, the
// provider's callback, the account it finds or makes, invitations, and the
// code the app redeems with its PKCE verifier.
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { pkceChallenge } from "../src/oidc.ts";
import { type TestServer, bearer, setUp, signIn, startServer } from "./app.ts";
import { type TestProvider, startProvider } from "./provider.ts";

const publicUrl = "https://nether.example.org";
const app = "http://127.0.0.1:43123/signed-in?from=nether";
const ada = { sub: "ada-1", email: "ada@example.org", email_verified: true, name: "Ada L." };
const bea = { sub: "bea-1", email: "bea@example.org", email_verified: true, name: "Bea" };

let running: TestServer | undefined;
let provider: TestProvider | undefined;

afterEach(async () => {
  await running?.close();
  await provider?.close();
  running = undefined;
  provider = undefined;
});

async function start(env: Record<string, string> = {}) {
  provider = await startProvider();
  running = await startServer({
    env: {
      NETHER_PUBLIC_URL: `${publicUrl}/`,
      NETHER_OIDC_ISSUER: provider.issuer,
      NETHER_OIDC_CLIENT_ID: provider.clientId,
      NETHER_OIDC_CLIENT_SECRET: provider.clientSecret,
      NETHER_OIDC_NAME: "Example SSO",
      ...env,
    },
  });
  return { ...running, ...(await setUp(running)), provider };
}

/** Starts a flow as the app does, signs in at the provider, and gives where the browser lands. */
async function signInWithProvider(
  test: TestServer & { provider: TestProvider },
  options: { redirect?: string; invitation?: string } = {},
) {
  const verifier = randomBytes(32).toString("base64url");
  const started = await test.server.inject({
    method: "POST",
    url: "/api/oidc/flows",
    payload: {
      redirect: options.redirect ?? app,
      challenge: pkceChallenge(verifier),
      ...(options.invitation === undefined ? {} : { invitation: options.invitation }),
    },
  });
  expect(started.statusCode, started.body).toBe(201);
  const callback = new URL(test.provider.authorize(started.json<{ url: string }>().url));
  expect(callback.origin + callback.pathname).toBe(`${publicUrl}/api/oidc/callback`);
  const answered = await test.server.inject({
    method: "GET",
    url: callback.pathname + callback.search,
  });
  expect(answered.statusCode, answered.body).toBe(302);
  const landed = new URL(String(answered.headers.location));
  return { landed, verifier, callback: callback.pathname + callback.search };
}

function redeem(test: TestServer, code: string, verifier: string) {
  return test.server.inject({
    method: "POST",
    url: "/api/oidc/redeem",
    payload: { code, verifier },
  });
}

describe("signing in with a provider", () => {
  it("finds an account by its verified address, and then by its identity", async () => {
    const test = await start();
    test.provider.person = ada;
    const { landed, verifier } = await signInWithProvider(test);
    expect(landed.origin + landed.pathname).toBe("http://127.0.0.1:43123/signed-in");
    expect(landed.searchParams.get("from")).toBe("nether");
    const code = landed.searchParams.get("code") ?? "";
    const signedIn = await redeem(test, code, verifier);
    expect(signedIn.statusCode).toBe(201);
    const body = signedIn.json<{ token: string; user: { id: string } }>();
    expect(body.user).toEqual({
      id: test.userId,
      name: "Ada",
      email: "Ada@Example.org",
      instanceAdmin: true,
    });
    const me = await test.server.inject({
      method: "GET",
      url: "/api/me",
      headers: bearer(body.token),
    });
    expect(me.statusCode).toBe(200);
    const { rows } = await test.db.query("SELECT issuer, subject, user_id FROM identities");
    expect(rows).toEqual([
      { issuer: test.provider.issuer, subject: "ada-1", user_id: test.userId },
    ]);

    // The identity signs in now, whatever address the provider gives.
    test.provider.person = { sub: "ada-1", email: "ada@elsewhere.org", email_verified: false };
    const again = await signInWithProvider(test);
    const second = await redeem(test, again.landed.searchParams.get("code") ?? "", again.verifier);
    expect(second.json()).toMatchObject({ user: { id: test.userId } });
  });

  it("refuses an address the provider has not verified, and a person with no account", async () => {
    const test = await start();
    test.provider.person = { ...ada, sub: "ada-2", email_verified: false };
    expect((await signInWithProvider(test)).landed.searchParams.get("error")).toBe(
      "email_not_verified",
    );
    test.provider.person = bea;
    const refused = await signInWithProvider(test);
    expect(refused.landed.searchParams.get("error")).toBe("no_account");
    expect(refused.landed.searchParams.has("code")).toBe(false);
    const { rows } = await test.db.query("SELECT count(*)::int AS users FROM users");
    expect(rows).toEqual([{ users: 1 }]);
    test.provider.person = undefined;
    expect((await signInWithProvider(test)).landed.searchParams.get("error")).toBe("access_denied");
  });

  it("makes an account, without a password, when sign-up is on", async () => {
    const test = await start({ NETHER_OIDC_SIGN_UP: "on" });
    test.provider.person = bea;
    const { landed, verifier } = await signInWithProvider(test);
    const made = await redeem(test, landed.searchParams.get("code") ?? "", verifier);
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      user: { name: "Bea", email: "bea@example.org", instanceAdmin: false },
    });
    expect(made.json()).not.toHaveProperty("workspace");
    const { rows } = await test.db.query(
      "SELECT password_hash FROM users WHERE email_key = 'bea@example.org'",
    );
    expect(rows).toEqual([{ password_hash: null }]);
    expect((await signIn(test.server, bea.email, "any password at all")).statusCode).toBe(401);
  });

  it("accepts an invitation, making the account it is for", async () => {
    const test = await start();
    const invite = (payload: object) =>
      test.server.inject({
        method: "POST",
        url: `/api/workspaces/${test.workspaceId}/invitations`,
        headers: bearer(test.token),
        payload,
      });
    const invitation = (await invite({ role: "member" })).json<{ token: string }>().token;
    test.provider.person = bea;
    const { landed, verifier } = await signInWithProvider(test, { invitation });
    const made = await redeem(test, landed.searchParams.get("code") ?? "", verifier);
    expect(made.json()).toMatchObject({
      user: { name: "Bea", email: "bea@example.org" },
      workspace: { id: test.workspaceId, name: "Team", role: "member" },
    });

    // Used, and so refused the next time.
    test.provider.person = { ...bea, sub: "cy-1", email: "cy@example.org" };
    expect((await signInWithProvider(test, { invitation })).landed.searchParams.get("error")).toBe(
      "invitation",
    );
    const forDee = (await invite({ role: "member", email: "dee@example.org" })).json<{
      token: string;
    }>().token;
    expect(
      (await signInWithProvider(test, { invitation: forDee })).landed.searchParams.get("error"),
    ).toBe("other_address");
    // An account signing in by its identity accepts it only for its address too.
    test.provider.person = ada;
    expect(
      (await signInWithProvider(test, { invitation: forDee })).landed.searchParams.get("error"),
    ).toBe("other_address");
  });

  it("gives a code that works once, within a minute, with the app's verifier", async () => {
    const test = await start();
    test.provider.person = ada;
    const first = await signInWithProvider(test);
    const code = first.landed.searchParams.get("code") ?? "";
    expect((await redeem(test, code, randomBytes(32).toString("base64url"))).statusCode).toBe(401);
    // Spent by the wrong try.
    expect((await redeem(test, code, first.verifier)).statusCode).toBe(401);

    const late = await signInWithProvider(test);
    await test.db.query("UPDATE oidc_flows SET expires_at = now() - interval '1 second'");
    const answer = await redeem(test, late.landed.searchParams.get("code") ?? "", late.verifier);
    expect(answer.statusCode).toBe(401);

    // The provider's answer is taken once.
    const used = await signInWithProvider(test);
    const replay = await test.server.inject({ method: "GET", url: used.callback });
    expect(replay.statusCode).toBe(400);
    expect(replay.body).toContain("Start again from the app");
  });

  it("sends the browser back only to the app's loopback address or the server's own", async () => {
    const test = await start();
    test.provider.person = ada;
    const challenge = pkceChallenge(randomBytes(32).toString("base64url"));
    const flow = (redirect: string) =>
      test.server.inject({
        method: "POST",
        url: "/api/oidc/flows",
        payload: { redirect, challenge },
      });
    for (const redirect of [
      "https://elsewhere.example.org/signed-in",
      "http://localhost:43123/signed-in",
      "http://nether.example.org/signed-in",
      "http://127.0.0.1:43123/#fragment",
      "http://user:secret@127.0.0.1:43123/",
      "not an address",
    ]) {
      expect((await flow(redirect)).statusCode, redirect).toBe(400);
    }
    for (const redirect of ["http://[::1]:43123/signed-in", `${publicUrl}/sign-in/done`]) {
      expect((await flow(redirect)).statusCode, redirect).toBe(201);
    }
    const web = await signInWithProvider(test, { redirect: `${publicUrl}/sign-in/done` });
    expect(web.landed.origin).toBe(publicUrl);
    expect(web.landed.searchParams.has("code")).toBe(true);
  });

  it("says when the provider cannot be reached, and how the app may sign in", async () => {
    const test = await start();
    const methods = await test.server.inject({ method: "GET", url: "/api/sign-in-methods" });
    expect(methods.json()).toEqual({
      password: true,
      emailCode: false,
      oidc: { name: "Example SSO" },
    });
    await test.provider.close();
    provider = undefined;
    const flow = await test.server.inject({
      method: "POST",
      url: "/api/oidc/flows",
      payload: { redirect: app, challenge: pkceChallenge(randomBytes(32).toString("base64url")) },
    });
    expect(flow.statusCode).toBe(503);
    expect(flow.json()).toMatchObject({
      message: "Example SSO cannot be reached; try again later.",
    });
  });

  it("is not offered by a server without a provider", async () => {
    running = await startServer();
    expect(
      (await running.server.inject({ method: "GET", url: "/api/sign-in-methods" })).json(),
    ).toMatchObject({ oidc: null });
    const flow = await running.server.inject({ method: "POST", url: "/api/oidc/flows" });
    expect(flow.statusCode).toBe(404);
  });
});

describe("the request to the provider", () => {
  it("asks for the address and name, and to come back to the server's address", async () => {
    const test = await start();
    const started = await test.server.inject({
      method: "POST",
      url: "/api/oidc/flows",
      payload: { redirect: app, challenge: pkceChallenge(randomBytes(32).toString("base64url")) },
    });
    const url = new URL(started.json<{ url: string }>().url);
    expect(url.searchParams.get("redirect_uri")).toBe(`${publicUrl}/api/oidc/callback`);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });
});
