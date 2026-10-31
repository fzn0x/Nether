// A workspace's members: who sees the list, who changes roles and removes
// whom, a workspace always keeping an owner, and a removed member's open
// connections closed, so their apps sync nothing more.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { type SetUp, type TestServer, bearer, setUp, startServer } from "./app.ts";

let running: TestServer | undefined;
const providers: HocuspocusProvider[] = [];

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.destroy();
  await running?.close();
  running = undefined;
});

type Test = TestServer & SetUp;

async function start(): Promise<Test> {
  running = await startServer();
  return { ...running, ...(await setUp(running)) };
}

/** Someone invited at a role, with their own new account; a guest is a member made one. */
async function join(test: Test, role: "admin" | "member" | "guest", name: string) {
  const invited = await test.server.inject({
    method: "POST",
    url: `/api/workspaces/${test.workspaceId}/invitations`,
    headers: bearer(test.token),
    payload: { role: role === "guest" ? "member" : role },
  });
  const accepted = await test.server.inject({
    method: "POST",
    url: "/api/invitations/accept",
    payload: {
      token: invited.json<{ token: string }>().token,
      name,
      email: `${name.toLowerCase()}@example.org`,
      password: `${name}'s long password`,
    },
  });
  const body = accepted.json<{ token: string; user: { id: string } }>();
  if (role === "guest") await setRole(test, test.token, body.user.id, "guest");
  return { token: body.token, id: body.user.id };
}

function members(test: Test, token: string) {
  return test.server.inject({
    method: "GET",
    url: `/api/workspaces/${test.workspaceId}/members`,
    headers: bearer(token),
  });
}

function setRole(test: Test, token: string, user: string, role: string) {
  return test.server.inject({
    method: "PATCH",
    url: `/api/workspaces/${test.workspaceId}/members/${user}`,
    headers: bearer(token),
    payload: { role },
  });
}

function remove(test: Test, token: string, user: string) {
  return test.server.inject({
    method: "DELETE",
    url: `/api/workspaces/${test.workspaceId}/members/${user}`,
    headers: bearer(token),
  });
}

describe("a workspace's members", () => {
  it("are listed for everyone but guests", async () => {
    const test = await start();
    const member = await join(test, "member", "Bea");
    const guest = await join(test, "guest", "Gus");
    const listed = await members(test, member.token);
    expect(listed.statusCode).toBe(200);
    const list = listed.json<{ members: { id: string; name: string; role: string }[] }>().members;
    expect(list.map(({ name, role }) => [name, role])).toEqual([
      ["Ada", "owner"],
      ["Bea", "member"],
      ["Gus", "guest"],
    ]);
    expect((await members(test, guest.token)).statusCode).toBe(403);
  });

  it("change roles as owners and admins may, keeping an owner", async () => {
    const test = await start();
    const admin = await join(test, "admin", "Ann");
    const member = await join(test, "member", "Bea");
    // An admin moves members and guests, and nothing above them.
    expect((await setRole(test, admin.token, member.id, "guest")).statusCode).toBe(200);
    expect((await setRole(test, admin.token, member.id, "admin")).statusCode).toBe(403);
    expect((await setRole(test, admin.token, test.userId, "member")).statusCode).toBe(403);
    // A member changes no one.
    expect((await setRole(test, member.token, admin.id, "member")).statusCode).toBe(403);
    // The only owner stays one; with a second, the first may step down.
    expect((await setRole(test, test.token, test.userId, "admin")).statusCode).toBe(409);
    expect((await setRole(test, test.token, admin.id, "owner")).statusCode).toBe(200);
    expect((await setRole(test, test.token, test.userId, "member")).statusCode).toBe(200);
    const roles = (await members(test, admin.token))
      .json<{ members: { name: string; role: string }[] }>()
      .members.map(({ name, role }) => [name, role]);
    expect(roles).toEqual([
      ["Ada", "member"],
      ["Ann", "owner"],
      ["Bea", "guest"],
    ]);
    // Stepped down, the first owner changes no one; no one is found who is not here.
    expect((await setRole(test, test.token, member.id, "member")).statusCode).toBe(403);
    expect((await setRole(test, admin.token, randomUUID(), "member")).statusCode).toBe(404);
  });

  it("are removed by owners and admins, and leave by themselves, keeping an owner", async () => {
    const test = await start();
    const admin = await join(test, "admin", "Ann");
    const member = await join(test, "member", "Bea");
    const other = await join(test, "member", "Cal");
    await test.db.query(
      "INSERT INTO workspace_keys (workspace_id, user_id, version, sealed_key) VALUES ($1, $2, 1, $3)",
      [test.workspaceId, member.id, new Uint8Array([1])],
    );
    expect((await remove(test, member.token, other.id)).statusCode).toBe(403);
    expect((await remove(test, admin.token, test.userId)).statusCode).toBe(403);
    expect((await remove(test, admin.token, member.id)).statusCode).toBe(204);
    expect((await remove(test, admin.token, member.id)).statusCode).toBe(404);
    const keys = await test.db.query("SELECT 1 FROM workspace_keys WHERE user_id = $1", [
      member.id,
    ]);
    expect(keys.rows).toEqual([]);
    // Gone, the workspace is not found for them.
    expect((await members(test, member.token)).statusCode).toBe(404);

    expect((await remove(test, other.token, other.id)).statusCode).toBe(204);
    expect((await remove(test, test.token, test.userId)).statusCode).toBe(409);
    expect((await remove(test, test.token, admin.id)).statusCode).toBe(204);
  });

  it("close a removed member's sync connections, which then sign in no more", async () => {
    const test = await start();
    const member = await join(test, "member", "Bea");
    await test.server.listen({ host: "127.0.0.1", port: 0 });
    const port = String((test.server.server.address() as AddressInfo).port);

    let refused: string | undefined;
    await new Promise<void>((resolve, reject) => {
      const provider = new HocuspocusProvider({
        url: `ws://127.0.0.1:${port}/api/sync`,
        name: `${test.workspaceId}/vault`,
        token: member.token,
        document: new Y.Doc(),
        onSynced: () => {
          resolve();
        },
        onAuthenticationFailed: ({ reason }) => {
          refused = reason;
          reject(new Error(reason));
        },
      });
      providers.push(provider);
    });
    const relay = new WebSocket(`ws://127.0.0.1:${port}/api/relay`);
    await new Promise<void>((resolve) => {
      relay.addEventListener("open", () => {
        relay.send(JSON.stringify({ type: "auth", token: member.token }));
      });
      relay.addEventListener("message", () => {
        resolve();
      });
    });
    const closed = new Promise<number>((resolve) => {
      relay.addEventListener("close", (event) => {
        resolve(event.code);
      });
    });

    expect((await remove(test, test.token, member.id)).statusCode).toBe(204);
    expect(await closed).toBe(4403);
    // The provider connects again, and is refused.
    const deadline = Date.now() + 10_000;
    while (refused === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(refused).toBeDefined();
  });
});
