// Encrypted workspaces on the server: accounts' keys, workspaces made
// encrypted with their maker's sealed key, keys sealed for members, and
// the relay that keeps and sends updates it cannot read.
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { type SetUp, type TestServer, bearer, setUp, signIn, startServer } from "./app.ts";

let running: TestServer | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await running?.close();
  running = undefined;
});

const b64 = (bytes: number) => randomBytes(bytes).toString("base64");

async function start(): Promise<TestServer & SetUp> {
  running = await startServer();
  return { ...running, ...(await setUp(running)) };
}

async function keys(test: TestServer, token: string) {
  return test.server.inject({
    method: "PUT",
    url: "/api/me/keys",
    headers: bearer(token),
    payload: { publicKey: b64(32), recoveryBox: b64(73) },
  });
}

async function encryptedWorkspace(test: TestServer, token: string, name = "Secret") {
  const made = await test.server.inject({
    method: "POST",
    url: "/api/workspaces",
    headers: bearer(token),
    payload: { name, encryption: "end-to-end", sealedKey: b64(80) },
  });
  return made.json<{ id: string }>().id;
}

/** A member of a workspace, with keys, as another person on another device. */
async function member(test: TestServer & SetUp, workspace: string, role = "member") {
  const invited = await test.server.inject({
    method: "POST",
    url: `/api/workspaces/${workspace}/invitations`,
    headers: bearer(test.token),
    payload: { role: "member" },
  });
  const accepted = await test.server.inject({
    method: "POST",
    url: "/api/invitations/accept",
    payload: {
      token: invited.json<{ token: string }>().token,
      name: "Bea",
      email: `bea-${randomUUID()}@example.org`,
      password: "bea's long password",
    },
  });
  const body = accepted.json<{ token: string; user: { id: string } }>();
  if (role !== "member") {
    await test.db.query("UPDATE memberships SET role = $1 WHERE user_id = $2", [
      role,
      body.user.id,
    ]);
  }
  return { token: body.token, id: body.user.id };
}

describe("keys and encrypted workspaces", () => {
  it("keeps an account's keys once, and gives them back", async () => {
    const test = await start();
    const me = () =>
      test.server.inject({ method: "GET", url: "/api/me/keys", headers: bearer(test.token) });
    expect((await me()).statusCode).toBe(404);
    const bad = await test.server.inject({
      method: "PUT",
      url: "/api/me/keys",
      headers: bearer(test.token),
      payload: { publicKey: b64(16), recoveryBox: b64(73) },
    });
    expect(bad.statusCode).toBe(400);
    expect((await keys(test, test.token)).statusCode).toBe(204);
    expect((await keys(test, test.token)).statusCode).toBe(409);
    const kept = (await me()).json<{ publicKey: string; recoveryBox: string }>();
    expect(Buffer.from(kept.publicKey, "base64")).toHaveLength(32);
    expect(Buffer.from(kept.recoveryBox, "base64")).toHaveLength(73);
  });

  it("makes an encrypted workspace only for an account with keys, with its sealed key", async () => {
    const test = await start();
    const make = (payload: object) =>
      test.server.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: bearer(test.token),
        payload,
      });
    expect((await make({ name: "Secret", encryption: "end-to-end" })).statusCode).toBe(400);
    expect(
      (await make({ name: "Secret", encryption: "end-to-end", sealedKey: b64(80) })).statusCode,
    ).toBe(409);
    await keys(test, test.token);
    const sealedKey = b64(80);
    const made = await make({ name: "Secret", encryption: "end-to-end", sealedKey });
    expect(made.statusCode).toBe(201);
    const { id } = made.json<{ id: string }>();
    expect(made.json()).toMatchObject({ name: "Secret", role: "owner", encryption: "end-to-end" });
    const plain = await make({ name: "Plain" });
    expect(plain.json()).toMatchObject({ role: "owner", encryption: "none" });

    const key = await test.server.inject({
      method: "GET",
      url: `/api/workspaces/${id}/key`,
      headers: bearer(test.token),
    });
    expect(key.json()).toEqual({ encryption: "end-to-end", version: 1, sealedKey });
    const me = await test.server.inject({
      method: "GET",
      url: "/api/me",
      headers: bearer(test.token),
    });
    expect(me.json()).toMatchObject({
      workspaces: [
        { name: "Team", encryption: "none" },
        { name: "Secret", encryption: "end-to-end" },
        { name: "Plain", encryption: "none" },
      ],
    });
  });

  it("lists the members waiting for the key, and lets one who has it seal it for them", async () => {
    const test = await start();
    await keys(test, test.token);
    const workspace = await encryptedWorkspace(test, test.token);
    const bea = await member(test, workspace);
    const keyless = () =>
      test.server.inject({
        method: "GET",
        url: `/api/workspaces/${workspace}/keyless`,
        headers: bearer(test.token),
      });
    // Without keys, Bea cannot be sealed for yet.
    expect((await keyless()).json()).toEqual({ members: [] });
    await keys(test, bea.token);
    const waiting = (await keyless()).json<{ members: { userId: string; version: number }[] }>();
    expect(waiting.members).toMatchObject([{ userId: bea.id, name: "Bea", version: 1 }]);
    const beaKey = () =>
      test.server.inject({
        method: "GET",
        url: `/api/workspaces/${workspace}/key`,
        headers: bearer(bea.token),
      });
    expect((await beaKey()).statusCode).toBe(404);

    const seal = (token: string, sealedKey: string) =>
      test.server.inject({
        method: "PUT",
        url: `/api/workspaces/${workspace}/keys/${bea.id}`,
        headers: bearer(token),
        payload: { version: 1, sealedKey },
      });
    // Bea has no key to seal with.
    expect((await seal(bea.token, b64(80))).statusCode).toBe(403);
    const sealedKey = b64(80);
    expect((await seal(test.token, sealedKey)).statusCode).toBe(204);
    // A copy kept is never replaced.
    expect((await seal(test.token, b64(80))).statusCode).toBe(409);
    expect((await beaKey()).json()).toMatchObject({ version: 1, sealedKey });
    expect((await keyless()).json()).toEqual({ members: [] });
  });
});

/** A relay client: its messages as they come, and a way to wait for one. */
async function relay(test: TestServer, token: string) {
  const address = test.server.server.address() as AddressInfo | null;
  if (address === null) await test.server.listen({ host: "127.0.0.1", port: 0 });
  const port = (test.server.server.address() as AddressInfo).port;
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/api/relay`);
  sockets.push(socket);
  const received: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  socket.addEventListener("message", (event) => {
    received.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    for (const waiter of waiters.splice(0)) waiter();
  });
  const closed = new Promise<{ code: number }>((resolve) => {
    socket.addEventListener("close", (event) => {
      resolve({ code: event.code });
      for (const waiter of waiters.splice(0)) waiter();
    });
  });
  await new Promise((resolve) => {
    socket.addEventListener("open", resolve);
  });
  const client = {
    received,
    closed,
    send: (message: object) => {
      socket.send(JSON.stringify(message));
    },
    /** The first message received that matches, waiting for it. */
    async next(match: (message: Record<string, unknown>) => boolean) {
      for (;;) {
        const found = received.find(match);
        if (found !== undefined) return found;
        if (socket.readyState === WebSocket.CLOSED) throw new Error("The relay closed");
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };
  client.send({ type: "auth", token });
  await client.next((message) => message.type === "ready");
  return client;
}

describe("the relay", () => {
  it("keeps encrypted updates in order and sends them to the document's other subscribers", async () => {
    const test = await start();
    await keys(test, test.token);
    const workspace = await encryptedWorkspace(test, test.token);
    const note = `${workspace}/${randomUUID()}`;
    const laptop = await relay(test, test.token);
    const phone = await relay(
      test,
      (await signIn(test.server, "ada@example.org", "a long password")).json<{ token: string }>()
        .token,
    );
    const vault = await relay(test, test.token);
    vault.send({ type: "subscribe", name: `${workspace}/vault`, after: 0 });
    await vault.next((message) => message.type === "subscribed");

    laptop.send({ type: "push", id: "1", name: note, data: "AAEC" });
    const pushed = await laptop.next((message) => message.type === "pushed");
    expect(pushed).toMatchObject({ id: "1", seq: expect.any(Number) as number });
    phone.send({ type: "subscribe", name: note, after: 0 });
    const stored = await phone.next((message) => message.type === "updates");
    expect(stored).toEqual({
      type: "updates",
      name: note,
      updates: [{ seq: pushed.seq, data: "AAEC" }],
    });
    expect(await phone.next((message) => message.type === "subscribed")).toEqual({
      type: "subscribed",
      name: note,
      seq: pushed.seq,
    });

    // Live, to the other subscriber, and the vault's subscribers hear of the note.
    laptop.send({ type: "push", id: "2", name: note, data: "AwQF" });
    const second = await laptop.next((message) => message.id === "2");
    await phone.next(
      (message) =>
        message.type === "updates" &&
        JSON.stringify(message.updates) === JSON.stringify([{ seq: second.seq, data: "AwQF" }]),
    );
    expect(
      await vault.next((message) => message.type === "stored" && message.seq === second.seq),
    ).toMatchObject({
      document: note.split("/")[1],
    });

    // A subscriber after a number gets only what came after it.
    const late = await relay(test, test.token);
    late.send({ type: "subscribe", name: note, after: pushed.seq });
    expect(await late.next((message) => message.type === "updates")).toMatchObject({
      updates: [{ seq: second.seq, data: "AwQF" }],
    });

    // The documents changed since a number list the note, as unencrypted ones do.
    const listed = await test.server.inject({
      method: "GET",
      url: `/api/workspaces/${workspace}/documents?since=0`,
      headers: bearer(test.token),
    });
    expect(listed.json()).toEqual({
      documents: [{ name: note.split("/")[1], seq: second.seq }],
      more: false,
    });
  });

  it("replaces the updates up to one with a snapshot", async () => {
    const test = await start();
    await keys(test, test.token);
    const workspace = await encryptedWorkspace(test, test.token);
    const note = `${workspace}/${randomUUID()}`;
    const client = await relay(test, test.token);
    const seqs: number[] = [];
    for (const [index, data] of ["AAAA", "BBBB", "CCCC"].entries()) {
      client.send({ type: "push", id: `p${String(index)}`, name: note, data });
      seqs.push((await client.next((message) => message.id === `p${String(index)}`)).seq as number);
    }
    client.send({
      type: "compact",
      id: "bad",
      name: note,
      through: (seqs[1] ?? 0) + 1000,
      data: "SNAP",
    });
    expect(await client.next((message) => message.id === "bad")).toMatchObject({ type: "error" });
    client.send({ type: "compact", id: "c", name: note, through: seqs[1], data: "SNAP" });
    expect(await client.next((message) => message.id === "c")).toEqual({
      type: "compacted",
      id: "c",
    });
    const reader = await relay(test, test.token);
    reader.send({ type: "subscribe", name: note, after: 0 });
    expect(await reader.next((message) => message.type === "updates")).toEqual({
      type: "updates",
      name: note,
      updates: [
        { seq: seqs[1], data: "SNAP" },
        { seq: seqs[2], data: "CCCC" },
      ],
    });
  });

  it("lets guests read and not push, and no one else in", async () => {
    const test = await start();
    await keys(test, test.token);
    const workspace = await encryptedWorkspace(test, test.token);
    const note = `${workspace}/${randomUUID()}`;
    const guest = await member(test, workspace, "guest");
    const reader = await relay(test, guest.token);
    reader.send({ type: "subscribe", name: note, after: 0 });
    await reader.next((message) => message.type === "subscribed");
    reader.send({ type: "push", id: "g", name: note, data: "AAAA" });
    expect(await reader.next((message) => message.id === "g")).toMatchObject({
      type: "error",
      message: "A guest may read this workspace, not change it.",
    });

    // Not a member, a workspace not encrypted, and a socket not signed in.
    const outsider = await relay(test, test.token);
    outsider.send({ type: "subscribe", name: `${randomUUID()}/vault`, after: 0 });
    expect(await outsider.next((message) => message.type === "error")).toMatchObject({
      message: "Sign in, as a member of this document's encrypted workspace.",
    });
    outsider.send({ type: "push", id: "x", name: `${test.workspaceId}/vault`, data: "AAAA" });
    expect(await outsider.next((message) => message.id === "x")).toMatchObject({ type: "error" });

    const port = (test.server.server.address() as AddressInfo).port;
    const anonymous = new WebSocket(`ws://127.0.0.1:${String(port)}/api/relay`);
    sockets.push(anonymous);
    await new Promise((resolve) => {
      anonymous.addEventListener("open", resolve);
    });
    const closed = new Promise<number>((resolve) => {
      anonymous.addEventListener("close", (event) => {
        resolve(event.code);
      });
    });
    anonymous.send(JSON.stringify({ type: "subscribe", name: note, after: 0 }));
    expect(await closed).toBe(4401);
  });

  it("keeps Hocuspocus from storing an encrypted workspace's notes in plain text", async () => {
    const test = await start();
    await keys(test, test.token);
    const workspace = await encryptedWorkspace(test, test.token);
    await test.server.listen({ host: "127.0.0.1", port: 0 });
    const port = (test.server.server.address() as AddressInfo).port;
    const refused = await new Promise<string>((resolve) => {
      const provider = new HocuspocusProvider({
        url: `ws://127.0.0.1:${String(port)}/api/sync`,
        name: `${workspace}/${randomUUID()}`,
        token: test.token,
        document: new Y.Doc(),
        onAuthenticationFailed: ({ reason }) => {
          provider.destroy();
          resolve(reason);
        },
      });
    });
    expect(refused).toBeTruthy();
  });
});
