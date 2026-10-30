// The local index of a vault: what each client keeps about the files, so it
// opens a large vault without reading every file again, and each note's
// document, its Yjs updates, kept before an edit counts as saved (ADR 0003).
import type { NoteId } from "@nether/core";

/** What the index knows of a file. */
export interface FileRecord {
  /** Relative to the vault, separated by slashes. */
  readonly path: string;
  /** The note's ID, for a Markdown file: it stays the same across renames. */
  readonly note?: NoteId;
  readonly size: number;
  readonly modified: number;
  /** The SHA-256 hash of the bytes last read or written, when known. */
  readonly hash?: string;
}

/** A change to the index, applied at once: removals first, then the rest. */
export interface IndexChange {
  readonly remove?: readonly string[];
  readonly upsert?: readonly FileRecord[];
}

/** One of a note's document updates, numbered in the order it was made. */
export interface StoredUpdate {
  readonly seq: number;
  readonly data: Uint8Array;
}

/** A note's document as the index keeps it. */
export interface StoredDocument {
  /** Its updates, oldest first: a snapshot of the earlier ones may come first. */
  readonly updates: readonly StoredUpdate[];
  /** The hash of the file's bytes the document last wrote or read. */
  readonly fileHash?: string;
}

/**
 * What the link index and search keep of a note, as JSON, with the size and
 * modification time of the file it was read from, to tell when it is stale.
 */
export interface NoteIndexRow {
  readonly note: NoteId;
  readonly size: number;
  readonly modified: number;
  readonly data: string;
}

/** Where a client keeps a vault's index. */
export interface IndexStore {
  /** Every file the index knows. */
  files(): Promise<readonly FileRecord[]>;
  apply(change: IndexChange): Promise<void>;
  /** A note's document; no updates for a note never opened. */
  document(note: NoteId): Promise<StoredDocument>;
  /** Adds updates to a note's document, all or none, each numbered after the last. */
  appendUpdates(note: NoteId, updates: readonly Uint8Array[]): Promise<void>;
  /** Replaces the updates numbered up to `through` with one snapshot of them. */
  compact(note: NoteId, snapshot: Uint8Array, through: number): Promise<void>;
  /** Records the hash of the file the document now matches. */
  setFileHash(note: NoteId, hash: string): Promise<void>;
  /** What the link index and search keep of every note read so far. */
  noteIndexes(): Promise<readonly NoteIndexRow[]>;
  /** Keeps notes' index rows, replacing those they had. */
  putNoteIndexes(rows: readonly NoteIndexRow[]): Promise<void>;
  deleteNoteIndexes(notes: readonly NoteId[]): Promise<void>;
  close(): Promise<void>;
}

/** An index kept in memory, for the browser preview and for tests. */
export class MemoryStore implements IndexStore {
  readonly #files = new Map<string, FileRecord>();
  readonly #documents = new Map<NoteId, { updates: StoredUpdate[]; fileHash?: string }>();
  readonly #indexes = new Map<NoteId, NoteIndexRow>();

  #document(note: NoteId) {
    let document = this.#documents.get(note);
    if (document === undefined) {
      document = { updates: [] };
      this.#documents.set(note, document);
    }
    return document;
  }

  files(): Promise<readonly FileRecord[]> {
    return Promise.resolve([...this.#files.values()]);
  }

  apply(change: IndexChange): Promise<void> {
    for (const path of change.remove ?? []) this.#files.delete(path);
    for (const record of change.upsert ?? []) this.#files.set(record.path, record);
    return Promise.resolve();
  }

  document(note: NoteId): Promise<StoredDocument> {
    const document = this.#documents.get(note);
    return Promise.resolve({
      updates: [...(document?.updates ?? [])],
      ...(document?.fileHash === undefined ? {} : { fileHash: document.fileHash }),
    });
  }

  appendUpdates(note: NoteId, updates: readonly Uint8Array[]): Promise<void> {
    const document = this.#document(note);
    for (const data of updates) {
      const seq = (document.updates[document.updates.length - 1]?.seq ?? 0) + 1;
      document.updates.push({ seq, data: data.slice() });
    }
    return Promise.resolve();
  }

  compact(note: NoteId, snapshot: Uint8Array, through: number): Promise<void> {
    const document = this.#document(note);
    document.updates = [
      { seq: through, data: snapshot.slice() },
      ...document.updates.filter((update) => update.seq > through),
    ];
    return Promise.resolve();
  }

  setFileHash(note: NoteId, hash: string): Promise<void> {
    this.#document(note).fileHash = hash;
    return Promise.resolve();
  }

  noteIndexes(): Promise<readonly NoteIndexRow[]> {
    return Promise.resolve([...this.#indexes.values()]);
  }

  putNoteIndexes(rows: readonly NoteIndexRow[]): Promise<void> {
    for (const row of rows) this.#indexes.set(row.note, row);
    return Promise.resolve();
  }

  deleteNoteIndexes(notes: readonly NoteId[]): Promise<void> {
    for (const note of notes) this.#indexes.delete(note);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
