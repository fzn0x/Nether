// The local index of a vault: what each client keeps about the files, so it
// opens a large vault without reading every file again (ADR 0003).
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

/** Where a client keeps a vault's index. */
export interface IndexStore {
  /** Every file the index knows. */
  files(): Promise<readonly FileRecord[]>;
  apply(change: IndexChange): Promise<void>;
  close(): Promise<void>;
}

/** An index kept in memory, for the browser preview and for tests. */
export class MemoryStore implements IndexStore {
  readonly #files = new Map<string, FileRecord>();

  files(): Promise<readonly FileRecord[]> {
    return Promise.resolve([...this.#files.values()]);
  }

  apply(change: IndexChange): Promise<void> {
    for (const path of change.remove ?? []) this.#files.delete(path);
    for (const record of change.upsert ?? []) this.#files.set(record.path, record);
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
