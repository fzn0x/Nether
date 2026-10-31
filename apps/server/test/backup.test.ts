// Backups (ADR 0052), as an admin restores one: a server's database and
// attachments written to a file and restored into a new database and store,
// where everything is as it was and the server runs on it; a backup of an
// older schema restored and brought to this one; and what is refused.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildApp } from "../src/app.ts";
import { DiskBlobs } from "../src/blobs.ts";
import {
  RestoreError,
  backupBytesLines,
  backupFileLines,
  restoreBackupLines,
  writeBackupFile,
} from "../src/backup.ts";
import { readConfig } from "../src/config.ts";
import type { Database } from "../src/db.ts";
import { migrate, schemaVersion } from "../src/migrations.ts";
import { storeDocument } from "../src/sync.ts";
import { type TestServer, admin, setUp, startServer } from "./app.ts";
import { testDatabase } from "./database.ts";

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function folder(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "nether-backup-"));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function database(): Promise<Database> {
  const db = await testDatabase();
  cleanups.push(() => db.close());
  return db;
}

function noteState(text: string): Uint8Array {
  const document = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  document.getXmlFragment("content").push([paragraph]);
  return Y.encodeStateAsUpdate(document);
}

/** Every table's rows, in a stable order, for two databases to be compared. */
async function contents(db: Database): Promise<Record<string, unknown[]>> {
  const { rows: tables } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
       AND table_name <> 'schema_migrations' ORDER BY table_name`,
  );
  const all: Record<string, unknown[]> = {};
  for (const { table_name: table } of tables) {
    const { rows } = await db.query(`SELECT * FROM "${String(table)}"`);
    all[String(table)] = rows
      .map((row) =>
        JSON.stringify(row, (_key, value: unknown) =>
          value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value,
        ),
      )
      .sort();
  }
  return all;
}

describe("backups", () => {
  let running: TestServer | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it("restore a server's database and attachments into new ones, the server running on them", async () => {
    const store = new DiskBlobs(await folder());
    running = await startServer({ blobs: store });
    const set = await setUp(running);
    const note = randomUUID();
    await storeDocument(running.db, set.workspaceId, note, noteState("one"));
    await storeDocument(running.db, set.workspaceId, note, noteState("two"));
    const bytes = new TextEncoder().encode("a picture");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await store.put(`${set.workspaceId}/${hash}`, bytes);
    await running.db.query(
      "INSERT INTO attachments (workspace_id, hash, size, content_type) VALUES ($1, $2, $3, 'image/png')",
      [set.workspaceId, hash, bytes.length],
    );

    const file = join(await folder(), "nether-backup.ndjson.gz");
    const written = await writeBackupFile(running.db, store, file);
    expect(written).toMatchObject({ blobs: 1, missing: 0 });
    expect(written.rows).toBeGreaterThan(5);

    const restoredDb = await database();
    const restoredStore = new DiskBlobs(await folder());
    const restored = await restoreBackupLines(restoredDb, restoredStore, backupFileLines(file));
    expect(restored).toEqual({ rows: written.rows, blobs: 1, schema: schemaVersion });
    expect(await contents(restoredDb)).toEqual(await contents(running.db));
    expect(await restoredStore.get(`${set.workspaceId}/${hash}`)).toEqual(bytes);

    // The sequences go on from where they were: a note stored next gets a newer number.
    const { rows: before } = await running.db.query("SELECT max(seq) AS seq FROM documents");
    const next = await storeDocument(restoredDb, set.workspaceId, randomUUID(), noteState("three"));
    expect(next).toBeGreaterThan(Number(before[0]?.seq));

    // A server on the restored database signs its admin in.
    const server = await buildApp(
      readConfig({ NETHER_DATABASE_URL: "postgres://unused", NETHER_LOG_LEVEL: "silent" }),
      { db: restoredDb, blobs: restoredStore },
    );
    cleanups.push(() => server.close());
    const signedIn = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { email: admin.email, password: admin.password },
    });
    expect(signedIn.statusCode).toBe(201);
  });

  it("restore a backup of an older schema, then bring it to this one", async () => {
    const old = await database();
    await migrate(old, 8);
    const workspace = randomUUID();
    await old.query("INSERT INTO workspaces (id, name) VALUES ($1, 'Old')", [workspace]);
    await old.query(
      "INSERT INTO documents (workspace_id, name, state, seq) VALUES ($1, 'vault', $2, nextval('document_seq'))",
      [workspace, new Uint8Array([0, 0])],
    );
    const file = join(await folder(), "old.ndjson.gz");
    const store = new DiskBlobs(await folder());
    await writeBackupFile(old, store, file);

    const restoredDb = await database();
    const restored = await restoreBackupLines(restoredDb, store, backupFileLines(file));
    expect(restored.schema).toBe(8);
    const { rows } = await restoredDb.query(
      "SELECT max(version) AS version FROM schema_migrations",
    );
    expect(Number(rows[0]?.version)).toBe(schemaVersion);
    const { rows: kept } = await restoredDb.query("SELECT name FROM workspaces");
    expect(kept).toEqual([{ name: "Old" }]);
  });

  it("migrate a database across every version in one step", async () => {
    const db = await database();
    expect(await migrate(db, 3)).toEqual({ from: 0, to: 3 });
    expect(await migrate(db)).toEqual({ from: 3, to: schemaVersion });
    expect(await migrate(db, 2)).toEqual({ from: schemaVersion, to: schemaVersion });
  });

  it("refuse a database that is not empty, a newer schema, and what is not a backup", async () => {
    const store = new DiskBlobs(await folder());
    const full = await database();
    await migrate(full);
    /** Lines as a backup file gives them, one at a time. */
    const lines = (...items: unknown[]): AsyncIterable<string> =>
      Readable.from(items.map((item) => JSON.stringify(item)));
    const header = (schema: number) => ({
      format: "nether-backup",
      version: 1,
      schema,
      created: new Date().toISOString(),
    });
    await expect(restoreBackupLines(full, store, lines(header(1)))).rejects.toThrow(/not empty/);
    const empty = await database();
    await expect(
      restoreBackupLines(empty, store, lines(header(schemaVersion + 1))),
    ).rejects.toThrow(/newer than this server/);
    await expect(restoreBackupLines(empty, store, lines({ hello: 1 }))).rejects.toBeInstanceOf(
      RestoreError,
    );
    await expect(restoreBackupLines(empty, store, lines(header(1), { what: 1 }))).rejects.toThrow(
      /does not read/,
    );
  });

  it("read a backup held in memory, as one fetched from S3", async () => {
    const gzip = createGzip();
    const chunks: Buffer[] = [];
    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    const ended = new Promise((resolve) => gzip.on("end", resolve));
    gzip.end('{"a":1}\n{"b":2}\n');
    await ended;
    const read: string[] = [];
    for await (const line of backupBytesLines(Buffer.concat(chunks))) read.push(line);
    expect(read).toEqual(['{"a":1}', '{"b":2}']);
  });
});
