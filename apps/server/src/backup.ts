// Backups (ADR 0052): the database and the attachments in one gzipped file
// of JSON lines, made in a consistent, read-only snapshot, and restored into
// an empty database. A backup names the schema version it was made at; a
// restore brings the database to that version, loads the rows, and then
// migrates them to this server's, so a backup restores into any later
// server of the same major release. No `pg_dump` is needed, nor one whose
// version matches the database's.
//
// The file: a header line, then for each table, in an order its foreign
// keys allow, a line naming it and its columns and a line a row; then the
// sequences' values; then each attachment's bytes.
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGunzip, createGzip } from "node:zlib";
import type { BlobStore } from "./blobs.ts";
import { type Database, type Queryable, readText } from "./db.ts";
import { migrate, schemaVersion } from "./migrations.ts";

/** What the first line of a backup says. */
export interface BackupHeader {
  readonly format: "nether-backup";
  readonly version: 1;
  /** The schema version of the database it was made from. */
  readonly schema: number;
  readonly created: string;
}

interface Column {
  readonly name: string;
  /** As information_schema names it: `bytea`, `jsonb`, `ARRAY`, `timestamp with time zone`… */
  readonly type: string;
}

type Line =
  | BackupHeader
  | { readonly table: string; readonly columns: readonly Column[] }
  | { readonly row: readonly unknown[] }
  | { readonly sequence: string; readonly value: string; readonly called: boolean }
  | { readonly blob: string; readonly data: string };

/** How many rows are read, or written, at a time. */
const pageSize = 500;

/** A name of the database as SQL writes it, quoted. */
function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** The tables of the schema, migrations' own record left out, parents before those whose keys point to them. */
async function tablesInOrder(db: Queryable): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
       AND table_name <> 'schema_migrations'
     ORDER BY table_name`,
  );
  const tables = rows.map((row) => String(row.table_name));
  const { rows: keys } = await db.query(
    `SELECT child.relname AS child, parent.relname AS parent
     FROM pg_constraint c
     JOIN pg_class child ON child.oid = c.conrelid
     JOIN pg_class parent ON parent.oid = c.confrelid
     JOIN pg_namespace n ON n.oid = child.relnamespace
     WHERE c.contype = 'f' AND n.nspname = current_schema()`,
  );
  const parents = new Map<string, Set<string>>(tables.map((table) => [table, new Set()]));
  for (const key of keys) {
    const child = String(key.child);
    const parent = String(key.parent);
    if (child !== parent) parents.get(child)?.add(parent);
  }
  const ordered: string[] = [];
  const placed = new Set<string>();
  const place = (table: string, path: Set<string>) => {
    if (placed.has(table) || path.has(table)) return;
    path.add(table);
    for (const parent of parents.get(table) ?? []) place(parent, path);
    placed.add(table);
    ordered.push(table);
  };
  for (const table of tables) place(table, new Set());
  return ordered;
}

/** A table's columns, in order, leaving out those the database works out itself. */
async function columnsOf(db: Queryable, table: string): Promise<Column[]> {
  const { rows } = await db.query(
    `SELECT column_name, data_type, is_generated FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return rows
    .filter((row) => row.is_generated !== "ALWAYS")
    .map((row) => ({ name: String(row.column_name), type: String(row.data_type) }));
}

/** A value as a line holds it: bytes as base64, times as ISO text, the rest as JSON has them. */
function encode(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return value;
}

/** A value as the database takes it again, by its column's type. */
function decode(value: unknown, column: Column): unknown {
  if (value === null) return null;
  if (typeof value === "object" && "$bytes" in value) {
    return Buffer.from(String(value.$bytes), "base64");
  }
  if (column.type === "jsonb" || column.type === "json") return JSON.stringify(value);
  return value;
}

/** The schema version the database is at. */
async function versionOf(db: Queryable): Promise<number> {
  const { rows } = await db.query(
    "SELECT COALESCE(max(version), 0) AS version FROM schema_migrations",
  );
  return Number(rows[0]?.version ?? 0);
}

/**
 * Writes a backup of the database and its attachments, line by line, to
 * `write`, in one read-only snapshot: what was committed when it began,
 * nothing after. Gives how many rows and attachments it wrote.
 */
export async function writeBackupLines(
  db: Database,
  blobs: BlobStore,
  write: (line: string) => Promise<void>,
  now = new Date(),
): Promise<{ readonly rows: number; readonly blobs: number; readonly missing: number }> {
  return db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const emit = (line: Line) => write(`${JSON.stringify(line)}\n`);
    await emit({
      format: "nether-backup",
      version: 1,
      schema: await versionOf(tx),
      created: now.toISOString(),
    });
    let rowCount = 0;
    for (const table of await tablesInOrder(tx)) {
      const columns = await columnsOf(tx, table);
      await emit({ table, columns });
      const names = columns.map((column) => quoted(column.name)).join(", ");
      // Page by the rows' place in the table, which the snapshot holds still.
      let after = "(0,0)";
      for (;;) {
        const { rows } = await tx.query(
          `SELECT ctid::text AS "$ctid", ${names} FROM ${quoted(table)}
           WHERE ctid > $1::tid ORDER BY ctid LIMIT ${String(pageSize)}`,
          [after],
        );
        for (const row of rows) {
          await emit({ row: columns.map((column) => encode(row[column.name])) });
        }
        rowCount += rows.length;
        const last = rows.at(-1);
        if (last === undefined || rows.length < pageSize) break;
        after = String(last.$ctid);
      }
    }
    const { rows: sequences } = await tx.query(
      `SELECT sequence_name FROM information_schema.sequences
       WHERE sequence_schema = current_schema() ORDER BY sequence_name`,
    );
    for (const sequence of sequences) {
      const name = String(sequence.sequence_name);
      const { rows } = await tx.query(
        `SELECT last_value::text AS last_value, is_called FROM ${quoted(name)}`,
      );
      await emit({
        sequence: name,
        // Read as text, as a bigint may not fit a number.
        value: readText(rows[0], "last_value"),
        called: rows[0]?.is_called === true,
      });
    }
    // The attachments' bytes, by the keys the database knows them by.
    const { rows: attachments } = await tx.query(
      "SELECT workspace_id, hash FROM attachments ORDER BY workspace_id, hash",
    );
    let blobCount = 0;
    let missing = 0;
    for (const attachment of attachments) {
      const key = `${String(attachment.workspace_id)}/${String(attachment.hash)}`;
      const data = await blobs.get(key);
      if (data === undefined) {
        missing++;
        continue;
      }
      await emit({ blob: key, data: Buffer.from(data).toString("base64") });
      blobCount++;
    }
    return { rows: rowCount, blobs: blobCount, missing };
  });
}

/** Writes a backup to a gzipped file. */
export async function writeBackupFile(
  db: Database,
  blobs: BlobStore,
  path: string,
  now = new Date(),
): Promise<{ readonly rows: number; readonly blobs: number; readonly missing: number }> {
  const gzip = createGzip();
  const done = pipeline(gzip, createWriteStream(path));
  const write = (line: string) =>
    new Promise<void>((resolve, reject) => {
      if (gzip.write(line)) resolve();
      else gzip.once("drain", resolve).once("error", reject);
    });
  try {
    const counts = await writeBackupLines(db, blobs, write, now);
    gzip.end();
    await done;
    return counts;
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : new Error(String(error)));
    await done.catch(() => undefined);
    throw error;
  }
}

/** A backup that cannot be restored: why. */
export class RestoreError extends Error {
  override readonly name = "RestoreError";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Restores a backup, given its lines, into an empty database: brings the
 * database to the schema version the backup was made at, loads its rows in
 * one transaction, puts its attachments back, and migrates the database to
 * this server's schema. Gives how many rows and attachments it restored.
 */
export async function restoreBackupLines(
  db: Database,
  blobs: BlobStore,
  lines: AsyncIterable<string>,
): Promise<{ readonly rows: number; readonly blobs: number; readonly schema: number }> {
  const { rows: existing } = await db.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`,
  );
  if (existing.length > 0 && (await versionOf(db)) > 0) {
    throw new RestoreError(
      "The database is not empty: restore into a new database, so nothing in it is overwritten.",
    );
  }
  const iterator = lines[Symbol.asyncIterator]();
  const first = await iterator.next();
  const header: unknown = first.done === true ? undefined : JSON.parse(first.value);
  if (!isObject(header) || header.format !== "nether-backup" || header.version !== 1) {
    throw new RestoreError("This is not a Nether backup.");
  }
  const schema = Number(header.schema);
  if (!Number.isInteger(schema) || schema < 1)
    throw new RestoreError("The backup names no schema version.");
  if (schema > schemaVersion) {
    throw new RestoreError(
      `The backup was made at schema version ${String(schema)}, newer than this server's ${String(schemaVersion)}: restore it with a newer server.`,
    );
  }
  await migrate(db, schema);

  let rowCount = 0;
  let blobCount = 0;
  await db.transaction(async (tx) => {
    let table: string | undefined;
    let columns: readonly Column[] = [];
    let batch: unknown[][] = [];
    const flush = async () => {
      if (table === undefined || batch.length === 0) return;
      const values: unknown[] = [];
      const tuples = batch.map((row) => {
        const places = columns.map((column, at) => {
          values.push(decode(row[at], column));
          return `$${String(values.length)}`;
        });
        return `(${places.join(", ")})`;
      });
      await tx.query(
        `INSERT INTO ${quoted(table)} (${columns.map((column) => quoted(column.name)).join(", ")})
         VALUES ${tuples.join(", ")}`,
        values,
      );
      rowCount += batch.length;
      batch = [];
    };
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      if (next.value.trim() === "") continue;
      const line: unknown = JSON.parse(next.value);
      if (!isObject(line)) throw new RestoreError("The backup has a line that is not an object.");
      if (typeof line.table === "string" && Array.isArray(line.columns)) {
        await flush();
        table = line.table;
        columns = line.columns as Column[];
        // The backup is what the table holds: rows a migration put there go.
        await tx.query(`DELETE FROM ${quoted(table)}`);
      } else if (Array.isArray(line.row)) {
        batch.push(line.row);
        if (batch.length >= pageSize / 5) await flush();
      } else if (typeof line.sequence === "string") {
        await flush();
        await tx.query(`SELECT setval($1, $2::bigint, $3)`, [
          quoted(line.sequence),
          String(line.value),
          line.called === true,
        ]);
      } else if (typeof line.blob === "string" && typeof line.data === "string") {
        await flush();
        // Put back as they are read: a backup's attachments may be more than memory holds.
        await blobs.put(line.blob, Buffer.from(line.data, "base64"));
        blobCount++;
      } else {
        throw new RestoreError("The backup has a line Nether does not read.");
      }
    }
    await flush();
  });
  await migrate(db);
  return { rows: rowCount, blobs: blobCount, schema };
}

/**
 * The lines of a gzipped backup file. The file is opened when the first
 * line is asked for: a reader made sooner reads on its own, and lines it
 * reads before they are asked for are lost.
 */
export async function* backupFileLines(path: string): AsyncGenerator<string> {
  yield* createInterface({
    input: createReadStream(path).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
}

/** The lines of a gzipped backup held in memory, as one fetched from S3, read as they are asked for. */
export async function* backupBytesLines(bytes: Uint8Array): AsyncGenerator<string> {
  yield* createInterface({
    input: Readable.from([bytes]).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
}
