// Two devices syncing one vault through a real Nether server, on PGlite:
// linking a vault and opening it elsewhere, edits both ways and at once,
// notes made, moved and removed, and edits made offline.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "@nether/server/src/app.ts";
import { readConfig } from "@nether/server/src/config.ts";
import type { Database } from "@nether/server/src/db.ts";
import { migrate } from "@nether/server/src/migrations.ts";
import { newSetupCode } from "@nether/server/src/setup.ts";
import { testDatabase } from "@nether/server/test/database.ts";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type HeldDocument,
  type SyncRecord,
  type SyncStore,
  type SyncVault,
  VaultSync,
} from "../src/engine.ts";

const password = "a long password";

/** A vault in memory: notes by ID, each with its path and its live document. */
class MemoryVault implements SyncVault {
  readonly notes = new Map<string, { path: string; document: Y.Doc }>();
  readonly #listeners = new Set<(id?: string) => void>();

  paths(): Map<string, string> {
    return new Map([...this.notes].map(([id, note]) => [id, note.path]));
  }

  watch(listener: (id?: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  hold(id: string): Promise<HeldDocument> {
    const note = this.notes.get(id);
    if (note === undefined) return Promise.reject(new Error(`No note ${id}`));
    return Promise.resolve({ document: note.document, release: () => undefined });
  }

  create(id: string, path: string, state: Uint8Array): Promise<void> {
    const document = new Y.Doc();
    Y.applyUpdate(document, state);
    this.notes.set(id, { path, document });
    return Promise.resolve();
  }

  move(id: string, path: string): Promise<void> {
    const note = this.notes.get(id);
    if (note !== undefined) note.path = path;
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.notes.delete(id);
    return Promise.resolve();
  }

  // What the person does on this device.

  write(path: string, text: string): string {
    const id = randomUUID();
    const document = new Y.Doc();
    document.getText("content").insert(0, text);
    this.notes.set(id, { path, document });
    this.#tell();
    this.#tell(id);
    return id;
  }

  edit(id: string, change: (text: Y.Text) => void): void {
    const note = this.notes.get(id);
    if (note === undefined) throw new Error(`No note ${id}`);
    change(note.document.getText("content"));
    this.#tell(id);
  }

  rename(id: string, path: string): void {
    const note = this.notes.get(id);
    if (note !== undefined) note.path = path;
    this.#tell();
  }

  delete(id: string): void {
    this.notes.delete(id);
    this.#tell();
  }

  text(id: string): string | undefined {
    return this.notes.get(id)?.document.getText("content").toJSON();
  }

  #tell(id?: string): void {
    for (const listener of this.#listeners) listener(id);
  }
}

class MemoryStore implements SyncStore {
  record: SyncRecord | undefined;

  load(): Promise<SyncRecord | undefined> {
    return Promise.resolve(this.record);
  }

  save(record: SyncRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }
}

const config = readConfig({
  NETHER_DATABASE_URL: "postgres://nether@localhost:5432/nether",
  NETHER_LOG_LEVEL: "silent",
});

let server: Awaited<ReturnType<typeof buildApp>> | undefined;
let db: Database | undefined;
const engines: VaultSync[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
  await server?.close();
  await db?.close();
  server = undefined;
  db = undefined;
});

/** A set-up server, listening, with the admin's address and first workspace. */
async function startServer() {
  db = await testDatabase();
  await migrate(db);
  const setupCode = newSetupCode();
  server = await buildApp(config, { db, setupCode });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${String((server.server.address() as AddressInfo).port)}`;
  const setUp = await fetch(`${url}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: setupCode,
      name: "Ada",
      email: "ada@example.org",
      password,
      workspace: "Team",
    }),
  });
  const body = (await setUp.json()) as { token: string; workspace: { id: string } };
  return { url, token: body.token, workspaceId: body.workspace.id };
}

/** Another session for the same account, as a second device has. */
async function signIn(url: string): Promise<string> {
  const response = await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.org", password }),
  });
  return ((await response.json()) as { token: string }).token;
}

async function device(
  served: { url: string; workspaceId: string },
  token: string,
  vault = new MemoryVault(),
  store = new MemoryStore(),
) {
  const engine = await VaultSync.start({
    server: served.url,
    token,
    workspaceId: served.workspaceId,
    vault,
    store,
  });
  engines.push(engine);
  return { engine, vault, store };
}

/** Waits until `check` holds, letting the server store and tell, 20 seconds at most. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for sync");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("syncing a vault", () => {
  it("sends a linked vault's notes, and makes them on another device with their IDs", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const ideas = laptop.write("Ideas.md", "# Ideas");
    const plan = laptop.write("Projects/Plan.md", "# Plan");
    const first = await device(served, served.token, laptop);
    await until(() => first.engine.status.state === "synced");

    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.notes.size === 2);
    expect(phone.vault.paths()).toEqual(laptop.paths());
    expect(phone.vault.text(ideas)).toBe("# Ideas");
    expect(phone.vault.text(plan)).toBe("# Plan");
    // What the device knows is kept: the agreed paths, and nothing left to send.
    await until(() => (first.store.record?.pending.length ?? -1) === 0);
    expect(first.store.record?.base).toEqual(Object.fromEntries(laptop.paths()));
  });

  it("sends edits both ways, and merges edits made on both at once", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const note = laptop.write("Ideas.md", "middle");
    await device(served, served.token, laptop);
    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.text(note) === "middle");

    laptop.edit(note, (text) => {
      text.insert(text.length, " end");
    });
    phone.vault.edit(note, (text) => {
      text.insert(0, "start ");
    });
    await until(
      () =>
        laptop.text(note) === "start middle end" && phone.vault.text(note) === "start middle end",
    );
  });

  it("makes, moves and removes on one device what another did", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const kept = laptop.write("Kept.md", "kept");
    const gone = laptop.write("Gone.md", "gone");
    await device(served, served.token, laptop);
    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.notes.size === 2);

    const fresh = laptop.write("Fresh.md", "fresh");
    phone.vault.rename(kept, "Archive/Kept.md");
    laptop.delete(gone);
    await until(
      () =>
        phone.vault.text(fresh) === "fresh" &&
        laptop.paths().get(kept) === "Archive/Kept.md" &&
        !phone.vault.notes.has(gone),
    );
    expect(phone.vault.paths()).toEqual(laptop.paths());
  });

  it("keeps edits made offline, and sends them when the device is back", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const note = laptop.write("Ideas.md", "one");
    await device(served, served.token, laptop);
    const token = await signIn(served.url);
    const phone = await device(served, token);
    await until(() => phone.vault.text(note) === "one");

    // The phone goes offline, and both go on writing.
    await phone.engine.stop();
    phone.vault.edit(note, (text) => {
      text.insert(text.length, " two");
    });
    const offline = phone.vault.write("Offline.md", "written offline");
    laptop.edit(note, (text) => {
      text.insert(0, "zero ");
    });

    // The phone's vault and what it kept, as after the app starts again.
    await device(served, token, phone.vault, phone.store);
    await until(
      () =>
        laptop.text(note) === "zero one two" &&
        phone.vault.text(note) === "zero one two" &&
        laptop.text(offline) === "written offline",
    );
  });
});
