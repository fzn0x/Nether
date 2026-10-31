// Sync: Hocuspocus providers, as the apps will use them, editing notes
// through the server over WebSockets, with their documents kept in
// PostgreSQL and the changes listed by number.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import { type Database, readBytes } from "../src/db.ts";
import { migrate } from "../src/migrations.ts";
import { newSetupCode } from "../src/setup.ts";
import type { Stored } from "../src/sync.ts";
import { type SetUp, admin, bearer, setUp, signIn } from "./app.ts";
import { testDatabase } from "./database.ts";
import { freePort } from "./ports.ts";

const config = readConfig({
  NETHER_DATABASE_URL: "postgres://nether@localhost:5432/nether",
  NETHER_LOG_LEVEL: "silent",
});

const providers: HocuspocusProvider[] = [];
let server: FastifyInstance | undefined;
let db: Database | undefined;

/** The database the test keeps across its servers. */
function database(): Database {
  if (db === undefined) throw new Error("The test has no database yet.");
  return db;
}

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.destroy();
  await server?.close();
  server = undefined;
  await db?.close();
  db = undefined;
});

/** A server listening on a free port, on the database the test keeps, set up. */
async function listen(setupCode = newSetupCode()): Promise<FastifyInstance> {
  db ??= await testDatabase();
  await migrate(db);
  server = await buildApp(config, { db, setupCode });
  await server.listen({ host: "127.0.0.1", port: await freePort() });
  return server;
}

async function start(): Promise<{ server: FastifyInstance; url: string } & SetUp> {
  const setupCode = newSetupCode();
  const app = await listen(setupCode);
  const ids = await setUp({ server: app, db: database(), setupCode, close: () => app.close() });
  return { server: app, url: urlOf(app), ...ids };
}

function urlOf(app: FastifyInstance): string {
  return `ws://127.0.0.1:${String((app.server.address() as AddressInfo).port)}/api/sync`;
}

/** A provider that has synced its document, or the reason it was refused. */
function connect(
  url: string,
  name: string,
  token: string,
  onStateless?: (payload: string) => void,
): Promise<HocuspocusProvider> {
  return new Promise((resolve, reject) => {
    const provider = new HocuspocusProvider({
      url,
      name,
      token,
      document: new Y.Doc(),
      onSynced: () => {
        resolve(provider);
      },
      onAuthenticationFailed: ({ reason }) => {
        reject(new Error(reason));
      },
      ...(onStateless === undefined
        ? {}
        : {
            onStateless: ({ payload }) => {
              onStateless(payload);
            },
          }),
    });
    providers.push(provider);
  });
}

function text(provider: HocuspocusProvider): Y.Text {
  return provider.document.getText("content");
}

/** Resolves when a provider's text reads as given. */
function whenText(provider: HocuspocusProvider, expected: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (text(provider).toJSON() === expected) {
        provider.document.off("update", check);
        resolve();
      }
    };
    provider.document.on("update", check);
    check();
  });
}

async function newSession(app: FastifyInstance): Promise<string> {
  return (await signIn(app, admin.email, admin.password)).json<{ token: string }>().token;
}

describe("sync", () => {
  it("lets two clients edit one note, each seeing the other's edits", async () => {
    const test = await start();
    const name = `${test.workspaceId}/${randomUUID()}`;
    const laptop = await connect(test.url, name, test.token);
    const phone = await connect(test.url, name, await newSession(test.server));
    text(laptop).insert(0, "Hello");
    await whenText(phone, "Hello");
    text(phone).insert(5, ", world");
    await whenText(laptop, "Hello, world");
  });

  it("keeps each note in PostgreSQL, so it outlasts the server", async () => {
    const test = await start();
    const note = randomUUID();
    const name = `${test.workspaceId}/${note}`;
    const writer = await connect(test.url, name, test.token);
    text(writer).insert(0, "Kept");
    writer.destroy();
    // Closing stores what is waiting.
    await test.server.close();

    const { rows } = await database().query(
      "SELECT state FROM documents WHERE workspace_id = $1 AND name = $2",
      [test.workspaceId, note],
    );
    const stored = new Y.Doc();
    Y.applyUpdate(stored, readBytes(rows[0], "state"));
    expect(stored.getText("content").toJSON()).toBe("Kept");

    const again = await listen();
    const reader = await connect(urlOf(again), name, test.token);
    expect(text(reader).toJSON()).toBe("Kept");
  });

  it("refuses a token that signs no one in, and documents not of the account's workspaces", async () => {
    const test = await start();
    const note = randomUUID();
    await expect(connect(test.url, `${test.workspaceId}/${note}`, "not-a-token")).rejects.toThrow();
    await expect(connect(test.url, `${randomUUID()}/${note}`, test.token)).rejects.toThrow();
    await expect(connect(test.url, `${test.workspaceId}/notes`, test.token)).rejects.toThrow();
    await expect(
      connect(test.url, `${test.workspaceId}/${note}`, test.token),
    ).resolves.toBeDefined();
  });

  it("opens a unit's documents at each one's level: a viewer reads and does not write", async () => {
    const test = await start();
    const join = async (person: string) => {
      const invited = await test.server.inject({
        method: "POST",
        url: `/api/workspaces/${test.workspaceId}/invitations`,
        headers: bearer(test.token),
        payload: { role: "member" },
      });
      const accepted = await test.server.inject({
        method: "POST",
        url: "/api/invitations/accept",
        payload: {
          token: invited.json<{ token: string }>().token,
          name: person,
          email: `${person.toLowerCase()}@example.org`,
          password: `${person}'s long password`,
        },
      });
      return accepted.json<{ token: string; user: { id: string } }>();
    };
    const viewer = await join("Vic");
    const outsider = await join("Oz");
    const guest = await join("Gus");
    await database().query("UPDATE memberships SET role = 'guest' WHERE user_id = $1", [
      guest.user.id,
    ]);
    // A teamspace the viewer may view, and a note in it.
    const made = await test.server.inject({
      method: "POST",
      url: `/api/workspaces/${test.workspaceId}/teamspaces`,
      headers: bearer(test.token),
      payload: { name: "Design" },
    });
    const unit = made.json<{ id: string }>().id;
    await test.server.inject({
      method: "PUT",
      url: `/api/workspaces/${test.workspaceId}/units/${unit}/grants/${viewer.user.id}`,
      headers: bearer(test.token),
      payload: { level: "view" },
    });
    const note = randomUUID();
    await test.server.inject({
      method: "PUT",
      url: `/api/workspaces/${test.workspaceId}/notes/${note}/unit`,
      headers: bearer(test.token),
      payload: { unit },
    });

    const name = `${test.workspaceId}/${note}`;
    // Neither someone the teamspace has not, nor a guest, opens its note or its list.
    await expect(connect(test.url, name, outsider.token)).rejects.toThrow();
    await expect(
      connect(test.url, `${test.workspaceId}/vault.${unit}`, outsider.token),
    ).rejects.toThrow();
    await expect(connect(test.url, name, guest.token)).rejects.toThrow();
    // Guests open no General either.
    await expect(connect(test.url, `${test.workspaceId}/vault`, guest.token)).rejects.toThrow();
    const owner = await connect(test.url, name, test.token);
    const reader = await connect(test.url, name, viewer.token);
    text(owner).insert(0, "Read me");
    await whenText(reader, "Read me");
    text(reader).insert(0, "Not ");
    expect(reader.authorizedScope).toBe("readonly");
    expect(owner.authorizedScope).toBe("read-write");
    // The guest's edit went before the owner's next one came back, so the
    // server has had it by the time it closes, and stores what it accepted.
    text(owner).insert(7, ".");
    await whenText(reader, "Not Read me.");
    await test.server.close();
    const { rows } = await database().query("SELECT state FROM documents WHERE name = $1", [
      name.split("/")[1],
    ]);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, readBytes(rows[0], "state"));
    expect(stored.getText("content").toJSON()).toBe("Read me.");
    expect(text(owner).toJSON()).toBe("Read me.");
  });

  it("lists the documents stored since a number, and tells the vault's clients", async () => {
    const test = await start();
    const heard: Stored[] = [];
    const storedNote = new Promise<void>((resolve) => {
      void connect(test.url, `${test.workspaceId}/vault`, test.token, (payload) => {
        heard.push(JSON.parse(payload) as Stored);
        resolve();
      });
    });
    const note = randomUUID();
    const writer = await connect(test.url, `${test.workspaceId}/${note}`, test.token);
    text(writer).insert(0, "Listed");
    await storedNote;
    expect(heard).toEqual([{ type: "stored", document: note, seq: expect.any(Number) as number }]);

    const changes = (since: number) =>
      test.server.inject({
        method: "GET",
        url: `/api/workspaces/${test.workspaceId}/documents?since=${String(since)}`,
        headers: bearer(test.token),
      });
    const all = await changes(0);
    expect(all.json()).toEqual({ documents: [{ name: note, seq: heard[0]?.seq }], more: false });
    expect((await changes(heard[0]?.seq ?? 0)).json()).toEqual({ documents: [], more: false });

    const elsewhere = await test.server.inject({
      method: "GET",
      url: `/api/workspaces/${randomUUID()}/documents`,
      headers: bearer(test.token),
    });
    expect(elsewhere.statusCode).toBe(404);
  });
});
