// Invitations: made by a workspace's owners and admins, looked up and
// accepted once, by a new account or a signed-in one, within seven days.
import { afterEach, describe, expect, it } from "vitest";
import { tokenHash } from "../src/sessions.ts";
import { type SetUp, type TestServer, bearer, setUp, signIn, startServer } from "./app.ts";

let running: TestServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const bea = { name: "Bea", email: "bea@example.org", password: "bea's long password" };

async function start(): Promise<TestServer & SetUp> {
  running = await startServer();
  return { ...running, ...(await setUp(running)) };
}

function invite(test: TestServer & SetUp, payload: object, token = test.token) {
  return test.server.inject({
    method: "POST",
    url: `/api/workspaces/${test.workspaceId}/invitations`,
    headers: bearer(token),
    payload,
  });
}

function accept(test: TestServer, payload: object, headers: Record<string, string> = {}) {
  return test.server.inject({ method: "POST", url: "/api/invitations/accept", headers, payload });
}

describe("invitations", () => {
  it("bring a new person into the workspace with a new account, once", async () => {
    const test = await start();
    const made = await invite(test, { role: "member" });
    expect(made.statusCode).toBe(201);
    const invitation = made.json<{ id: string; token: string; expiresAt: string }>();
    const days = (Date.parse(invitation.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    const { rows } = await test.db.query("SELECT token_hash FROM invitations");
    expect(rows).toEqual([{ token_hash: tokenHash(invitation.token) }]);

    const lookup = await test.server.inject({
      method: "POST",
      url: "/api/invitations/lookup",
      payload: { token: invitation.token },
    });
    expect(lookup.json()).toMatchObject({
      workspace: { id: test.workspaceId, name: "Team" },
      role: "member",
      email: null,
      invitedBy: "Ada",
    });

    expect((await accept(test, { token: invitation.token })).statusCode).toBe(400);
    const accepted = await accept(test, { token: invitation.token, ...bea });
    expect(accepted.statusCode).toBe(201);
    const body = accepted.json<{ token: string; user: object; workspace: object }>();
    expect(body.user).toMatchObject({
      name: "Bea",
      email: "bea@example.org",
      instanceAdmin: false,
    });
    expect(body.workspace).toEqual({ id: test.workspaceId, name: "Team", role: "member" });
    const me = await test.server.inject({
      method: "GET",
      url: "/api/me",
      headers: bearer(body.token),
    });
    expect(me.json()).toMatchObject({ workspaces: [{ name: "Team", role: "member" }] });
    expect((await signIn(test.server, bea.email, bea.password)).statusCode).toBe(201);

    // Used once.
    const again = await accept(test, {
      token: invitation.token,
      ...bea,
      email: "bee@example.org",
    });
    expect(again.statusCode).toBe(404);
    expect(
      (
        await test.server.inject({
          method: "POST",
          url: "/api/invitations/lookup",
          payload: { token: invitation.token },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("are accepted into a signed-in account, and keep a member's role", async () => {
    const test = await start();
    const first = (await invite(test, { role: "member" })).json<{ token: string }>();
    const bee = (await accept(test, { token: first.token, ...bea })).json<{ token: string }>();

    // Bea is in Team as a member; an invitation as admin keeps her a member.
    const second = (await invite(test, { role: "admin" })).json<{ token: string }>();
    const accepted = await accept(test, { token: second.token }, bearer(bee.token));
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      workspace: { name: "Team", role: "member" },
      user: { email: "bea@example.org" },
    });
    expect(accepted.json()).not.toHaveProperty("token");

    // A session that has ended does not quietly make a second account.
    const third = (await invite(test, { role: "member" })).json<{ token: string }>();
    const stale = await accept(test, { token: third.token, ...bea }, bearer("ended"));
    expect(stale.statusCode).toBe(401);
  });

  it("for an address are accepted only by that address", async () => {
    const test = await start();
    const made = (await invite(test, { role: "admin", email: " Bea@Example.org " })).json<{
      token: string;
      email: string;
    }>();
    expect(made.email).toBe("Bea@Example.org");
    const wrong = await accept(test, { token: made.token, ...bea, email: "eve@example.org" });
    expect(wrong.statusCode).toBe(403);
    const right = await accept(test, { token: made.token, ...bea });
    expect(right.statusCode).toBe(201);
    expect(right.json()).toMatchObject({ workspace: { role: "admin" } });

    // Signed in as the admin, whose address is not Bea's.
    const other = (await invite(test, { role: "member", email: "cy@example.org" })).json<{
      token: string;
    }>();
    expect((await accept(test, { token: other.token }, bearer(test.token))).statusCode).toBe(403);
  });

  it("will not make a second account for an address", async () => {
    const test = await start();
    const made = (await invite(test, { role: "member" })).json<{ token: string }>();
    const taken = await accept(test, {
      token: made.token,
      ...bea,
      email: "ADA@example.org",
    });
    expect(taken.statusCode).toBe(409);
  });

  it("expire after seven days, and can be listed and withdrawn", async () => {
    const test = await start();
    const old = (await invite(test, { role: "member" })).json<{ token: string }>();
    await test.db.query("UPDATE invitations SET expires_at = now() - interval '1 second'");
    expect((await accept(test, { token: old.token, ...bea })).statusCode).toBe(404);

    const made = (await invite(test, { role: "member", email: "bea@example.org" })).json<{
      id: string;
      token: string;
    }>();
    const url = `/api/workspaces/${test.workspaceId}/invitations`;
    const list = await test.server.inject({ method: "GET", url, headers: bearer(test.token) });
    expect(list.json()).toMatchObject({
      invitations: [{ id: made.id, role: "member", email: "bea@example.org", invitedBy: "Ada" }],
    });
    const withdrawn = await test.server.inject({
      method: "DELETE",
      url: `${url}/${made.id}`,
      headers: bearer(test.token),
    });
    expect(withdrawn.statusCode).toBe(204);
    expect((await accept(test, { token: made.token, ...bea })).statusCode).toBe(404);
  });

  it("are made only by the workspace's owners and admins", async () => {
    const test = await start();
    const made = (await invite(test, { role: "member" })).json<{ token: string }>();
    const member = (await accept(test, { token: made.token, ...bea })).json<{ token: string }>();
    expect((await invite(test, { role: "member" }, member.token)).statusCode).toBe(403);
    expect((await invite(test, { role: "owner" })).statusCode).toBe(400);
    expect((await invite(test, { role: "guest" })).statusCode).toBe(400);

    // A workspace the account is not in, real or not, is not found.
    const elsewhere = await test.server.inject({
      method: "POST",
      url: "/api/workspaces/00000000-0000-4000-8000-000000000000/invitations",
      headers: bearer(test.token),
      payload: { role: "member" },
    });
    expect(elsewhere.statusCode).toBe(404);
    const unsigned = await test.server.inject({
      method: "POST",
      url: `/api/workspaces/${test.workspaceId}/invitations`,
      payload: { role: "member" },
    });
    expect(unsigned.statusCode).toBe(401);
  });
});
