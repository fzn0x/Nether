// The local index of a vault: what each client keeps about the files, so it
// opens a large vault without reading every file again, and each note's
// document, its Yjs updates, kept before an edit counts as saved (ADR 0003).
import type { NoteId } from "@nether/core";
import { type SearchQuery, foldText } from "@nether/search";

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

/** A note's title and text, as search reads them. */
export interface NoteTextRow {
  readonly note: NoteId;
  readonly title: string;
  readonly body: string;
}

/** A note that matches a search, with the text around a match, each match between \u0002 and \u0003. */
export interface TextHit {
  readonly note: NoteId;
  readonly snippet: string;
}

/** The marks around a match in a snippet. */
export const matchStart = "\u0002";
export const matchEnd = "\u0003";

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
  /** Keeps notes' titles and text for search, replacing those they had. */
  putNoteTexts(rows: readonly NoteTextRow[]): Promise<void>;
  deleteNoteTexts(notes: readonly NoteId[]): Promise<void>;
  /**
   * The notes whose title or text has every word and phrase of a query, and
   * none it excludes, the best first, at most `limit`; its filters are the
   * caller's to apply.
   */
  searchText(query: SearchQuery, limit: number): Promise<readonly TextHit[]>;
  close(): Promise<void>;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a word or phrase stands in folded text as whole words, as FTS5 finds them. */
function wordIn(text: string, part: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(part)}($|[^\\p{L}\\p{N}])`, "u").test(text);
}

/** The text around the first match of `part`, marked as FTS5's snippet marks it. */
function snippetOf(body: string, part: string): string {
  const folded = foldText(body);
  const at = part === "" ? -1 : folded.indexOf(part);
  if (at === -1) return body.slice(0, 120);
  const start = Math.max(0, at - 40);
  const end = Math.min(body.length, at + part.length + 60);
  return `${start > 0 ? "…" : ""}${body.slice(start, at)}${matchStart}${body.slice(at, at + part.length)}${matchEnd}${body.slice(at + part.length, end)}${end < body.length ? "…" : ""}`;
}

/** An index kept in memory, for the browser preview and for tests. */
export class MemoryStore implements IndexStore {
  readonly #files = new Map<string, FileRecord>();
  readonly #documents = new Map<NoteId, { updates: StoredUpdate[]; fileHash?: string }>();
  readonly #indexes = new Map<NoteId, NoteIndexRow>();
  readonly #texts = new Map<NoteId, NoteTextRow>();

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

  putNoteTexts(rows: readonly NoteTextRow[]): Promise<void> {
    for (const row of rows) this.#texts.set(row.note, row);
    return Promise.resolve();
  }

  deleteNoteTexts(notes: readonly NoteId[]): Promise<void> {
    for (const note of notes) this.#texts.delete(note);
    return Promise.resolve();
  }

  searchText(query: SearchQuery, limit: number): Promise<readonly TextHit[]> {
    const words = query.words.map(foldText);
    const phrases = query.phrases.map(foldText);
    const excluded = query.excluded.map(foldText);
    if (words.length === 0 && phrases.length === 0) return Promise.resolve([]);
    const hits: { hit: TextHit; score: number }[] = [];
    for (const row of this.#texts.values()) {
      const title = foldText(row.title);
      const text = `${title}\n${foldText(row.body)}`;
      const has = (part: string, prefix: boolean) =>
        prefix
          ? new RegExp(`(^|[^\\p{L}\\p{N}])${escape(part)}`, "u").test(text)
          : wordIn(text, part);
      const found =
        words.every((word, index) => has(word, index === words.length - 1)) &&
        phrases.every((phrase) => wordIn(text, phrase)) &&
        !excluded.some((part) => wordIn(text, part));
      if (!found) continue;
      const first = [...words, ...phrases][0] ?? "";
      const score = title.includes(first) ? 2 : 1;
      hits.push({ hit: { note: row.note, snippet: snippetOf(row.body, first) }, score });
    }
    return Promise.resolve(
      hits
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ hit }) => hit),
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
