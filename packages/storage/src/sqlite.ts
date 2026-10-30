// The index in SQLite, as the desktop keeps it through MyGO's SQLite plugin
// and the mobile apps will through Capacitor's. The schema is versioned with
// SQLite's user_version, and each version's migration runs once.
import type { NoteId } from "@nether/core";
import type { FileRecord, IndexChange, IndexStore } from "./store.ts";

export type SqlValue = string | number | bigint | Uint8Array | null;

export interface Statement {
  readonly sql: string;
  readonly params?: readonly SqlValue[];
}

/** A SQLite connection, as MyGO's SQLite plugin exposes one. */
export interface Database {
  execute(sql: string, params?: readonly SqlValue[]): Promise<unknown>;
  query(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<{
    readonly columns: readonly string[];
    readonly rows: readonly (readonly SqlValue[])[];
  }>;
  /** Runs the statements in one transaction, all or none. */
  transaction(statements: readonly Statement[]): Promise<unknown>;
  close(): Promise<void>;
}

/** Each version's statements, in order: the index of a migration is the version it reaches, less one. */
const migrations: readonly (readonly string[])[] = [
  [
    `CREATE TABLE files (
      path TEXT PRIMARY KEY NOT NULL,
      note TEXT UNIQUE,
      size INTEGER NOT NULL,
      modified INTEGER NOT NULL,
      hash TEXT
    ) WITHOUT ROWID`,
  ],
];

/** The schema version this code writes. */
export const schemaVersion = migrations.length;

/** Statements per transaction when a change is large, so no single call grows without end. */
const chunk = 2000;

function text(value: SqlValue | undefined): string {
  if (typeof value !== "string") throw new Error("The index holds a value of the wrong type.");
  return value;
}

function integer(value: SqlValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("The index holds a value of the wrong type.");
}

/** Brings the database up to the current schema, refusing one written by a newer Nether. */
export async function migrate(database: Database): Promise<void> {
  const { rows } = await database.query("PRAGMA user_version");
  const version = integer(rows[0]?.[0] ?? 0);
  if (version > schemaVersion) {
    throw new Error(
      `This vault's index was written by a newer version of Nether (schema ${String(version)}). Update Nether to open it.`,
    );
  }
  for (let next = version; next < schemaVersion; next++) {
    const statements = (migrations[next] ?? []).map((sql) => ({ sql }));
    await database.transaction([
      ...statements,
      // PRAGMA takes no parameters: the version is a number this code chose.
      { sql: `PRAGMA user_version = ${String(next + 1)}` },
    ]);
  }
}

/** The index in a SQLite database. */
export class SqliteStore implements IndexStore {
  readonly #database: Database;

  private constructor(database: Database) {
    this.#database = database;
  }

  /** Opens the index in a database, migrating it first. */
  static async open(database: Database): Promise<SqliteStore> {
    await migrate(database);
    return new SqliteStore(database);
  }

  async files(): Promise<readonly FileRecord[]> {
    const { rows } = await this.#database.query(
      "SELECT path, note, size, modified, hash FROM files",
    );
    return rows.map(([path, note, size, modified, hash]) => ({
      path: text(path),
      ...(note === null || note === undefined ? {} : { note: text(note) as NoteId }),
      size: integer(size),
      modified: integer(modified),
      ...(hash === null || hash === undefined ? {} : { hash: text(hash) }),
    }));
  }

  async apply(change: IndexChange): Promise<void> {
    const statements: Statement[] = [
      ...(change.remove ?? []).map((path) => ({
        sql: "DELETE FROM files WHERE path = ?",
        params: [path],
      })),
      ...(change.upsert ?? []).map((record) => ({
        sql: `INSERT INTO files (path, note, size, modified, hash) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (path) DO UPDATE SET note = excluded.note, size = excluded.size,
          modified = excluded.modified, hash = excluded.hash`,
        params: [
          record.path,
          record.note ?? null,
          record.size,
          record.modified,
          record.hash ?? null,
        ],
      })),
    ];
    for (let start = 0; start < statements.length; start += chunk) {
      await this.#database.transaction(statements.slice(start, start + chunk));
    }
  }

  close(): Promise<void> {
    return this.#database.close();
  }
}
