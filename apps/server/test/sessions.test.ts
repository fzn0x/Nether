// Signing in and out, sessions and their ends, one's account and password,
// and the limits on guessing a password.
import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../src/passwords.ts";
import { tokenHash } from "../src/sessions.ts";
import { type TestServer, admin, bearer, setUp, signIn, startServer } from "./app.ts";

let running: TestServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(): Promise<TestServer> {
  running = await startServer();
  return running;
}

describe("signing in", () => {
  it("starts a session for the right password, and only a hash of its token is kept", async () => {
    const test = await start();
    const { userId } = await setUp(test);
    const response = await signIn(test.server, "ada@EXAMPLE.org", admin.password);
    expect(response.statusCode).toBe(201);
    const body = response.json<{ token: string; expiresAt: string; user: unknown }>();
    expect(body.user).toEqual({
      id: userId,
      name: "Ada",
      email: "Ada@Example.org",
      instanceAdmin: true,
    });
    expect(body.token).toMatch(/^[\w-]{43}$/);
    const days = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);

    const { rows } = await test.db.query("SELECT token_hash, client FROM sessions");
    expect(rows).toContainEqual({ token_hash: tokenHash(body.token), client: "test" });
    expect(JSON.stringify(rows)).not.toContain(body.token);
  });

  it("answers a wrong password and an unknown address alike", async () => {
    const test = await start();
    await setUp(test);
    const wrong = await signIn(test.server, admin.email, "not the password");
    const unknown = await signIn(test.server, "eve@example.org", admin.password);
    for (const response of [wrong, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        statusCode: 401,
        error: "Unauthorized",
        message: "That email address and password do not match an account.",
      });
    }
  });

  it("stops guessing one account's password, from any address, after ten tries", async () => {
    const test = await start();
    await setUp(test);
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await signIn(test.server, admin.email, `guess ${String(attempt)}`)).statusCode).toBe(
        401,
      );
    }
    const limited = await signIn(test.server, "ADA@example.org", admin.password);
    expect(limited.statusCode).toBe(429);
    // Most of the 15 minutes, less what the tries took on a slow runner.
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(780);
    expect(limited.json()).toMatchObject({
      statusCode: 429,
      error: "Too Many Requests",
      message: expect.stringMatching(/^Too many tries: try again in \d+ seconds\.$/) as unknown,
    });
    // Another account is not held back by it.
    expect((await signIn(test.server, "eve@example.org", "a guess")).statusCode).toBe(401);
  });

  it("stops one address after 30 tries in five minutes, whichever accounts it names", async () => {
    const test = await start();
    await setUp(test);
    for (let attempt = 0; attempt < 30; attempt++) {
      const email = `guess${String(attempt)}@example.org`;
      expect((await signIn(test.server, email, "a guess")).statusCode).toBe(401);
    }
    const limited = await signIn(test.server, admin.email, admin.password);
    expect(limited.statusCode).toBe(429);
    // Most of the five minutes, less what 30 tries took on a slow runner.
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(180);
    expect(limited.json()).toMatchObject({
      statusCode: 429,
      error: "Too Many Requests",
      message: expect.stringMatching(/^Too many tries: try again in \d+ seconds\.$/) as unknown,
    });
  });
});

describe("a session", () => {
  it("signs requests in, and nothing else does", async () => {
    const test = await start();
    const { token, workspaceId } = await setUp(test);
    const me = await test.server.inject({ method: "GET", url: "/api/me", headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { name: "Ada", email: "Ada@Example.org", instanceAdmin: true },
      workspaces: [{ id: workspaceId, name: "Team", role: "owner" }],
    });

    for (const headers of [{}, bearer("not-a-token"), { authorization: token }]) {
      const refused = await test.server.inject({ method: "GET", url: "/api/me", headers });
      expect(refused.statusCode).toBe(401);
      expect(refused.headers["www-authenticate"]).toBe("Bearer");
    }
  });

  it("ends when signed out, after 30 days unused, and 90 days after it began", async () => {
    const test = await start();
    const { token } = await setUp(test);
    const me = (session: string) =>
      test.server.inject({ method: "GET", url: "/api/me", headers: bearer(session) });

    const out = await test.server.inject({
      method: "DELETE",
      url: "/api/sessions/current",
      headers: bearer(token),
    });
    expect(out.statusCode).toBe(204);
    expect((await me(token)).statusCode).toBe(401);

    const idle = (await signIn(test.server, admin.email, admin.password)).json<{ token: string }>();
    await test.db.query(
      "UPDATE sessions SET used_at = now() - interval '30 days 1 minute' WHERE token_hash = $1",
      [tokenHash(idle.token)],
    );
    expect((await me(idle.token)).statusCode).toBe(401);

    const old = (await signIn(test.server, admin.email, admin.password)).json<{ token: string }>();
    await test.db.query(
      "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [tokenHash(old.token)],
    );
    expect((await me(old.token)).statusCode).toBe(401);

    // One used within the last 30 days lasts.
    const used = (await signIn(test.server, admin.email, admin.password)).json<{ token: string }>();
    await test.db.query(
      "UPDATE sessions SET used_at = now() - interval '29 days' WHERE token_hash = $1",
      [tokenHash(used.token)],
    );
    expect((await me(used.token)).statusCode).toBe(200);
    const { rows } = await test.db.query(
      "SELECT used_at > now() - interval '1 minute' AS fresh FROM sessions WHERE token_hash = $1",
      [tokenHash(used.token)],
    );
    expect(rows).toEqual([{ fresh: true }]);
  });

  it("lists its account's sessions, and ends others after the password again", async () => {
    const test = await start();
    const { token } = await setUp(test);
    const laptop = (await signIn(test.server, admin.email, admin.password, "laptop")).json<{
      token: string;
    }>();
    const phone = (await signIn(test.server, admin.email, admin.password, "phone")).json<{
      token: string;
    }>();
    const list = async () =>
      (
        await test.server.inject({ method: "GET", url: "/api/sessions", headers: bearer(token) })
      ).json<{ sessions: { id: string; client: string; current: boolean }[] }>().sessions;
    const sessions = await list();
    expect(sessions.map((session) => [session.client, session.current])).toEqual([
      ["lightMyRequest", true],
      ["laptop", false],
      ["phone", false],
    ]);

    const revoke = (payload: object) =>
      test.server.inject({
        method: "POST",
        url: "/api/sessions/revoke",
        headers: bearer(token),
        payload,
      });
    const laptopId = sessions[1]?.id ?? "";
    expect((await revoke({ session: laptopId })).statusCode).toBe(403);
    expect((await revoke({ session: laptopId, password: "not the password" })).statusCode).toBe(
      403,
    );
    expect((await revoke({ session: laptopId, password: admin.password })).statusCode).toBe(204);
    expect((await revoke({ session: laptopId, password: admin.password })).statusCode).toBe(404);
    const me = (session: string) =>
      test.server.inject({ method: "GET", url: "/api/me", headers: bearer(session) });
    expect((await me(laptop.token)).statusCode).toBe(401);
    expect((await me(phone.token)).statusCode).toBe(200);

    expect((await revoke({ password: admin.password })).statusCode).toBe(204);
    expect((await me(phone.token)).statusCode).toBe(401);
    expect((await list()).map((session) => session.current)).toEqual([true]);
  });
});

describe("a password change", () => {
  it("needs the current password, and ends every other session", async () => {
    const test = await start();
    const { token, userId } = await setUp(test);
    const other = (await signIn(test.server, admin.email, admin.password)).json<{
      token: string;
    }>();
    const change = (payload: object) =>
      test.server.inject({
        method: "PUT",
        url: "/api/me/password",
        headers: bearer(token),
        payload,
      });

    expect(
      (await change({ current: "not the password", password: "a new long one" })).statusCode,
    ).toBe(403);
    expect((await change({ current: admin.password, password: "short" })).statusCode).toBe(400);
    expect((await change({ current: admin.password, password: "a new long one" })).statusCode).toBe(
      204,
    );

    const { rows } = await test.db.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    const hash = rows[0]?.password_hash;
    expect(typeof hash === "string" && (await verifyPassword("a new long one", hash))).toBe(true);
    expect((await signIn(test.server, admin.email, admin.password)).statusCode).toBe(401);
    expect((await signIn(test.server, admin.email, "a new long one")).statusCode).toBe(201);
    const me = (session: string) =>
      test.server.inject({ method: "GET", url: "/api/me", headers: bearer(session) });
    expect((await me(token)).statusCode).toBe(200);
    expect((await me(other.token)).statusCode).toBe(401);
  });
});
