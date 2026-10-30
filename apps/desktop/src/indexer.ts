// Keeps a vault's link index and search current. What it read of each
// note is kept in the vault's index with the size and modification time
// of the note's file, so opening a vault reads only the notes that changed
// since; the rest it reads in the background, parsing them in a worker,
// and then each note again whenever its file changes or moves.
import type { NoteId } from "@nether/core";
import { LinkGraph, type NoteIndex } from "@nether/graph";
import type { Vault } from "@nether/storage";
import type { IndexRequest, IndexResponse } from "./indexer.worker.ts";

/** How many notes go to the worker at once. */
const batchSize = 100;

export interface IndexProgress {
  /** Notes read since the index last started reading, and how many it had to read. */
  readonly done: number;
  readonly total: number;
}

interface Known {
  readonly path: string;
  readonly size: number;
  readonly modified: number;
}

export class Indexer {
  readonly graph = new LinkGraph();
  readonly #vault: Vault;
  readonly #worker: Worker;
  readonly #known = new Map<NoteId, Known>();
  readonly #queue = new Set<NoteId>();
  readonly #listeners = new Set<() => void>();
  readonly #pending = new Map<number, (response: IndexResponse) => void>();
  #batches = 0;
  #progress: IndexProgress = { done: 0, total: 0 };
  #running = false;
  #stopped = false;
  #unsubscribe: (() => void) | undefined;

  constructor(vault: Vault, worker: Worker) {
    this.#vault = vault;
    this.#worker = worker;
    worker.onmessage = (event: MessageEvent<IndexResponse>) => {
      this.#pending.get(event.data.batch)?.(event.data);
      this.#pending.delete(event.data.batch);
    };
  }

  /** Loads what the vault's index kept, then reads what changed, and follows the vault. */
  async start(): Promise<void> {
    const rows = await this.#vault.indexes.noteIndexes();
    for (const row of rows) {
      const note = this.#vault.note(row.note);
      if (note === undefined) continue;
      try {
        this.graph.set(row.note, note.path, JSON.parse(row.data) as NoteIndex);
        this.#known.set(row.note, { path: note.path, size: row.size, modified: row.modified });
      } catch {
        // A row that cannot be read is read again from the note.
      }
    }
    this.#unsubscribe = this.#vault.subscribe(() => {
      this.#sync();
    });
    this.#sync();
  }

  stop(): void {
    this.#stopped = true;
    this.#unsubscribe?.();
    this.#worker.terminate();
  }

  /** Waits until every note the vault has is read, as a rename does before it rewrites links. */
  idle(): Promise<void> {
    const done = () => !this.#running && this.#queue.size === 0;
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = this.subscribe(() => {
        if (!done()) return;
        stop();
        resolve();
      });
    });
  }

  progress(): IndexProgress {
    return this.#progress;
  }

  /** Calls `listener` when the progress changes; returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(progress: IndexProgress): void {
    this.#progress = progress;
    for (const listener of this.#listeners) listener();
  }

  /** Finds the notes that are new, changed, moved or gone since the index last saw them. */
  #sync(): void {
    if (this.#stopped) return;
    const present = new Set<NoteId>();
    for (const note of this.#vault.notes()) {
      present.add(note.id);
      const known = this.#known.get(note.id);
      // Changed or moved: a move changes the title, which search reads.
      if (
        known?.size !== note.size ||
        known.modified !== note.modified ||
        known.path !== note.path
      ) {
        this.#queue.add(note.id);
      }
    }
    const gone = [...this.#known.keys()].filter((id) => !present.has(id));
    for (const id of gone) {
      this.#known.delete(id);
      this.graph.remove(id);
    }
    if (gone.length > 0) {
      void this.#vault.indexes.deleteNoteIndexes(gone);
      void this.#vault.indexes.deleteNoteTexts(gone);
    }
    if (this.#queue.size > 0 && !this.#running) void this.#read();
  }

  async #read(): Promise<void> {
    this.#running = true;
    let done = 0;
    try {
      while (this.#queue.size > 0 && !this.#stopped) {
        this.#emit({ done, total: done + this.#queue.size });
        const ids = [...this.#queue].slice(0, batchSize);
        for (const id of ids) this.#queue.delete(id);
        const notes: { id: string; text: string }[] = [];
        const seen = new Map<string, Known>();
        await this.#vault.readNotes(ids, (id, file) => {
          if (file.missing === true) return;
          const note = this.#vault.note(id);
          if (note === undefined) return;
          notes.push({ id, text: file.binary === true ? "" : file.text });
          // As the vault knows the note, so the next look finds it unchanged.
          seen.set(id, { path: note.path, size: note.size, modified: note.modified });
        });
        const response = await this.#parse(notes);
        const rows = response.results.flatMap(({ id, index }) => {
          const known = seen.get(id);
          if (known === undefined) return [];
          const note = id as NoteId;
          this.graph.set(note, known.path, index);
          this.#known.set(note, known);
          return [
            { note, size: known.size, modified: known.modified, data: JSON.stringify(index) },
          ];
        });
        const texts = response.results.flatMap(({ id, text }) => {
          const known = seen.get(id);
          const title = known?.path.slice(known.path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
          return title === undefined ? [] : [{ note: id as NoteId, title, body: text }];
        });
        // The text first: a note whose index row is kept is not read again.
        await this.#vault.indexes.putNoteTexts(texts);
        await this.#vault.indexes.putNoteIndexes(rows);
        done += ids.length;
      }
    } finally {
      this.#running = false;
      this.#emit({ done, total: done });
    }
  }

  #parse(notes: IndexRequest["notes"]): Promise<IndexResponse> {
    const batch = ++this.#batches;
    return new Promise((resolve) => {
      this.#pending.set(batch, resolve);
      this.#worker.postMessage({ batch, notes } satisfies IndexRequest);
    });
  }
}
