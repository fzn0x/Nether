// What the tests that sync devices through a real Nether server share: the
// server on PGlite, keeping attachments in memory, set up with an account
// and a workspace; a vault and a store in memory; devices; and waiting for
// sync.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "@nether/server/src/app.ts";
import type { BlobStore } from "@nether/server/src/blobs.ts";
import { readConfig } from "@nether/server/src/config.ts";
import type { Database } from "@nether/server/src/db.ts";
import { migrate } from "@nether/server/src/migrations.ts";
import { newSetupCode } from "@nether/server/src/setup.ts";
import { testDatabase } from "@nether/server/test/database.ts";
import * as Y from "yjs";
import {
  type HeldDocument,
  type SyncOptions,
  type SyncRecord,
  type SyncStore,
  type SyncVault,
  VaultSync,
} from "../src/engine.ts";
import { sha256 } from "../src/files.ts";
import { freePort } from "@nether/server/test/ports.ts";

export const password = "a long password";

/** A vault in memory: notes by ID, each with its path and its live document, and other files' bytes. */
export class MemoryVault implements SyncVault {
  readonly notes = new Map<string, { path: string; document: Y.Doc }>();
  readonly attachments = new Map<string, Uint8Array>();
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

  async files(): Promise<Map<string, string>> {
    const hashed = [...this.attachments].map(
      async ([path, bytes]) => [path, await sha256(bytes)] as const,
    );
    return new Map(await Promise.all(hashed));
  }

  async readFile(path: string): Promise<{ bytes: Uint8Array; hash: string }> {
    const bytes = this.attachments.get(path);
    if (bytes === undefined) throw new Error(`No file ${path}`);
    return { bytes: bytes.slice(), hash: await sha256(bytes) };
  }

  async writeFile(path: string, data: Uint8Array, base: string): Promise<void> {
    const current = this.attachments.get(path);
    if ((current === undefined ? "" : await sha256(current)) !== base) {
      throw new Error(`${path} changed since it was read.`);
    }
    this.attachments.set(path, data.slice());
  }

  moveFile(from: string, to: string): Promise<void> {
    const bytes = this.attachments.get(from);
    if (bytes === undefined || this.attachments.has(to)) {
      return Promise.reject(new Error(`Cannot move ${from} to ${to}`));
    }
    this.attachments.delete(from);
    this.attachments.set(to, bytes);
    return Promise.resolve();
  }

  removeFile(path: string): Promise<void> {
    this.attachments.delete(path);
    return Promise.resolve();
  }

  // What the person does on this device.

  /** Adds a file, or changes one; as text, its UTF-8 bytes. */
  attach(path: string, data: Uint8Array | string): void {
    this.attachments.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    this.#tell();
  }

  detach(path: string): void {
    this.attachments.delete(path);
    this.#tell();
  }

  /** A file's bytes as text. */
  file(path: string): string | undefined {
    const bytes = this.attachments.get(path);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

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

export class MemoryStore implements SyncStore {
  record: SyncRecord | undefined;

  load(): Promise<SyncRecord | undefined> {
    return Promise.resolve(this.record);
  }

  save(record: SyncRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }
}

/** The server's attachments, in memory. */
export class MemoryBlobs implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>();

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.blobs.has(key));
  }

  get(key: string): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.blobs.get(key));
  }

  put(key: string, data: Uint8Array): Promise<void> {
    if (!this.blobs.has(key)) this.blobs.set(key, data.slice());
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.blobs.delete(key);
    return Promise.resolve();
  }
}

let server: Awaited<ReturnType<typeof buildApp>> | undefined;
let db: Database | undefined;
let blobs: MemoryBlobs | undefined;
const engines: VaultSync[] = [];

/** Stops every device and the server, after each test. */
export async function stopAll(): Promise<void> {
  for (const engine of engines.splice(0)) await engine.stop();
  await server?.close();
  await db?.close();
  server = undefined;
  db = undefined;
  blobs = undefined;
}

/** The server's database, for a test to look into. */
export function database(): Database {
  if (db === undefined) throw new Error("No server is running.");
  return db;
}

/** The attachments the server keeps, for a test to look into. */
export function storedBlobs(): MemoryBlobs {
  if (blobs === undefined) throw new Error("No server is running.");
  return blobs;
}

/** A set-up server, listening, with the admin's address and first workspace; `env` adds to its settings. */
export async function startServer(env: Record<string, string> = {}) {
  db = await testDatabase();
  await migrate(db);
  const setupCode = newSetupCode();
  blobs = new MemoryBlobs();
  const config = readConfig({
    NETHER_DATABASE_URL: "postgres://nether@localhost:5432/nether",
    NETHER_LOG_LEVEL: "silent",
    ...env,
  });
  server = await buildApp(config, { db, setupCode, blobs });
  await server.listen({ host: "127.0.0.1", port: await freePort() });
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
export async function signIn(url: string): Promise<string> {
  const response = await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.org", password }),
  });
  return ((await response.json()) as { token: string }).token;
}

/** A device syncing a vault, with what it keeps; for an encrypted workspace, with its keys. */
export async function device(
  served: { url: string; workspaceId: string },
  token: string,
  vault = new MemoryVault(),
  store = new MemoryStore(),
  encryption?: SyncOptions["encryption"],
) {
  const engine = await VaultSync.start({
    server: served.url,
    token,
    workspaceId: served.workspaceId,
    vault,
    store,
    ...(encryption === undefined ? {} : { encryption }),
  });
  engines.push(engine);
  return { engine, vault, store };
}

/** Waits until `check` holds, letting the server store and tell, 20 seconds at most. */
export async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for sync");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
