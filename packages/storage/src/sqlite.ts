// The index in SQLite, as the desktop keeps it through MyGO's SQLite plugin
// and the mobile apps will through Capacitor's. The schema is versioned with
// SQLite's user_version, and each version's migration runs once.
import type { NoteId } from "@nether/core";
import type {
  FileRecord,
  IndexChange,
  IndexStore,
  NoteIndexRow,
  NoteTextRow,
  StoredDocument,
  StoredUpdate,
  TextHit,
} from "./store.ts";
import { type SearchQuery, ftsMatch } from "@nether/search";

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
  [
    // Each note's Yjs document: its updates in order, and the file it matches.
    `CREATE TABLE document_updates (
      note TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (note, seq)
    ) WITHOUT ROWID`,
    `CREATE TABLE documents (
      note TEXT PRIMARY KEY NOT NULL,
      file_hash TEXT
    ) WITHOUT ROWID`,
  ],
  [
    // What the link index and search keep of each note, and the file it was read from.
    `CREATE TABLE note_indexes (
      note TEXT PRIMARY KEY NOT NULL,
      size INTEGER NOT NULL,
      modified INTEGER NOT NULL,
      data TEXT NOT NULL
    ) WITHOUT ROWID`,
  ],
  [
    // Each note's title and text for full-text search, case and accents
    // aside, with prefixes of two and three letters indexed for typing.
    `CREATE VIRTUAL TABLE note_texts USING fts5(
      note UNINDEXED,
      title,
      body,
      tokenize = 'unicode61 remove_diacritics 2',
      prefix = '2 3'
    )`,
    // Every note is read again, to fill it.
    "DELETE FROM note_indexes",
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

function bytes(value: SqlValue | undefined): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("The index holds a value of the wrong type.");
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

  async document(note: NoteId): Promise<StoredDocument> {
    const { rows } = await this.#database.query(
      "SELECT seq, data FROM document_updates WHERE note = ? ORDER BY seq",
      [note],
    );
    const updates: StoredUpdate[] = rows.map(([seq, data]) => ({
      seq: integer(seq),
      data: bytes(data),
    }));
    const hash = await this.#database.query("SELECT file_hash FROM documents WHERE note = ?", [
      note,
    ]);
    const fileHash = hash.rows[0]?.[0];
    return typeof fileHash === "string" ? { updates, fileHash } : { updates };
  }

  async appendUpdates(note: NoteId, updates: readonly Uint8Array[]): Promise<void> {
    if (updates.length === 0) return;
    // Each numbered after the note's last, in one transaction.
    await this.#database.transaction(
      updates.map((data) => ({
        sql: `INSERT INTO document_updates (note, seq, data)
          SELECT ?, COALESCE(MAX(seq), 0) + 1, ? FROM document_updates WHERE note = ?`,
        params: [note, data, note],
      })),
    );
  }

  async compact(note: NoteId, snapshot: Uint8Array, through: number): Promise<void> {
    await this.#database.transaction([
      { sql: "DELETE FROM document_updates WHERE note = ? AND seq <= ?", params: [note, through] },
      {
        sql: "INSERT INTO document_updates (note, seq, data) VALUES (?, ?, ?)",
        params: [note, through, snapshot],
      },
    ]);
  }

  async setFileHash(note: NoteId, hash: string): Promise<void> {
    await this.#database.execute(
      `INSERT INTO documents (note, file_hash) VALUES (?, ?)
        ON CONFLICT (note) DO UPDATE SET file_hash = excluded.file_hash`,
      [note, hash],
    );
  }

  async noteIndexes(): Promise<readonly NoteIndexRow[]> {
    const { rows } = await this.#database.query(
      "SELECT note, size, modified, data FROM note_indexes",
    );
    return rows.map(([note, size, modified, data]) => ({
      note: text(note) as NoteId,
      size: integer(size),
      modified: integer(modified),
      data: text(data),
    }));
  }

  async putNoteIndexes(rows: readonly NoteIndexRow[]): Promise<void> {
    const statements = rows.map((row) => ({
      sql: `INSERT INTO note_indexes (note, size, modified, data) VALUES (?, ?, ?, ?)
        ON CONFLICT (note) DO UPDATE SET size = excluded.size, modified = excluded.modified,
        data = excluded.data`,
      params: [row.note, row.size, row.modified, row.data],
    }));
    for (let start = 0; start < statements.length; start += chunk) {
      await this.#database.transaction(statements.slice(start, start + chunk));
    }
  }

  async deleteNoteIndexes(notes: readonly NoteId[]): Promise<void> {
    const statements = notes.map((note) => ({
      sql: "DELETE FROM note_indexes WHERE note = ?",
      params: [note],
    }));
    for (let start = 0; start < statements.length; start += chunk) {
      await this.#database.transaction(statements.slice(start, start + chunk));
    }
  }

  async putNoteTexts(rows: readonly NoteTextRow[]): Promise<void> {
    const statements = rows.flatMap((row) => [
      { sql: "DELETE FROM note_texts WHERE note = ?", params: [row.note] },
      {
        sql: "INSERT INTO note_texts (note, title, body) VALUES (?, ?, ?)",
        params: [row.note, row.title, row.body],
      },
    ]);
    for (let start = 0; start < statements.length; start += chunk) {
      await this.#database.transaction(statements.slice(start, start + chunk));
    }
  }

  async deleteNoteTexts(notes: readonly NoteId[]): Promise<void> {
    const statements = notes.map((note) => ({
      sql: "DELETE FROM note_texts WHERE note = ?",
      params: [note],
    }));
    for (let start = 0; start < statements.length; start += chunk) {
      await this.#database.transaction(statements.slice(start, start + chunk));
    }
  }

  async searchText(query: SearchQuery, limit: number): Promise<readonly TextHit[]> {
    const match = ftsMatch(query);
    if (match === undefined) return [];
    // A title's match counts ten times its text's; the snippet marks matches as MemoryStore does.
    const { rows } = await this.#database.query(
      `SELECT note, snippet(note_texts, 2, char(2), char(3), '…', 16)
        FROM note_texts WHERE note_texts MATCH ?
        ORDER BY bm25(note_texts, 0.0, 10.0, 1.0) LIMIT ?`,
      [match, limit],
    );
    return rows.map(([note, snippet]) => ({
      note: text(note) as NoteId,
      snippet: typeof snippet === "string" ? snippet : "",
    }));
  }

  close(): Promise<void> {
    return this.#database.close();
  }
}
