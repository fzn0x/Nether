// Each note's comments' document (ADR 0044), kept in the vault's index
// beside the note's own document, and shared by whoever holds it: the
// comments panel and sync. Each change goes to the index after a moment,
// and listeners hear of those made here so they sync; the document is let
// go when the last holder lets go. Comments are not Markdown: they stay out
// of the note's file.
import type { NoteId } from "@nether/core";
import { type Vault, commentsDocument } from "@nether/storage";
import * as Y from "yjs";

/** How often changes go to the index, and how many rows it keeps before a snapshot. */
const persistEvery = 250;
const compactAfter = 100;

interface Entry {
  readonly document: Y.Doc;
  loaded: Promise<void>;
  holders: number;
  /** Changes waiting for the index; the number of the last stored, and the rows kept. */
  updates: Uint8Array[];
  seq: number;
  rows: number;
  persisting: Promise<void>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A hold on a note's comments' document; let it go when done. */
export interface CommentsHold {
  readonly document: Y.Doc;
  release(): void;
}

/** A vault's notes' comments, each document shared by everyone holding it. */
export class NoteComments {
  readonly #vault: Vault;
  readonly #open = new Map<NoteId, Entry>();
  readonly #listeners = new Set<(id: NoteId) => void>();

  constructor(vault: Vault) {
    this.#vault = vault;
  }

  /** Holds a note's comments, once loaded from the index. */
  async hold(id: NoteId): Promise<CommentsHold> {
    let entry = this.#open.get(id);
    if (entry === undefined) {
      entry = this.#load(id);
      this.#open.set(id, entry);
    }
    const held = entry;
    held.holders += 1;
    try {
      await held.loaded;
    } catch (error) {
      this.#letGo(id, held);
      throw error;
    }
    let released = false;
    return {
      document: held.document,
      release: () => {
        if (released) return;
        released = true;
        this.#letGo(id, held);
      },
    };
  }

  /** Calls `listener` with each note whose comments change here, not those sync brings; gives the way to stop. */
  subscribe(listener: (id: NoteId) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #load(id: NoteId): Entry {
    const document = new Y.Doc();
    const entry: Entry = {
      document,
      loaded: Promise.resolve(),
      holders: 0,
      updates: [],
      seq: 0,
      rows: 0,
      persisting: Promise.resolve(),
      timer: undefined,
    };
    entry.loaded = (async () => {
      const stored = await this.#vault.documents.document(commentsDocument(id));
      for (const update of stored.updates) Y.applyUpdate(document, update.data);
      entry.seq = stored.updates[stored.updates.length - 1]?.seq ?? 0;
      entry.rows = stored.updates.length;
      // From here on, every change goes to the index.
      document.on("update", (update: Uint8Array, origin: unknown) => {
        entry.updates.push(update);
        entry.timer ??= setTimeout(() => void this.#persist(id, entry), persistEvery);
        // Sync applies what it brings with an origin of its own; a change made here has none.
        if (origin === null || origin === undefined) {
          for (const listener of this.#listeners) listener(id);
        }
      });
    })();
    return entry;
  }

  /** Lets a hold go: the last one saves what is waiting and closes the document. */
  #letGo(id: NoteId, entry: Entry): void {
    entry.holders -= 1;
    if (entry.holders > 0) return;
    void this.#persist(id, entry).finally(() => {
      if (entry.holders > 0 || this.#open.get(id) !== entry) return;
      this.#open.delete(id);
      entry.document.destroy();
    });
  }

  /** Sends the changes waiting to the index as one row, and compacts it now and then. */
  #persist(id: NoteId, entry: Entry): Promise<void> {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.persisting = entry.persisting.then(async () => {
      if (entry.updates.length === 0) return;
      const batch = Y.mergeUpdates(entry.updates);
      entry.updates = [];
      const key = commentsDocument(id);
      await this.#vault.documents.appendUpdates(key, [batch]);
      entry.seq += 1;
      entry.rows += 1;
      if (entry.rows > compactAfter) {
        await this.#vault.documents.compact(key, Y.encodeStateAsUpdate(entry.document), entry.seq);
        entry.rows = 1;
      }
    });
    return entry.persisting;
  }
}

const registries = new WeakMap<Vault, NoteComments>();

/** The comments of a vault's notes, one registry per vault. */
export function noteComments(vault: Vault): NoteComments {
  let registry = registries.get(vault);
  if (registry === undefined) {
    registry = new NoteComments(vault);
    registries.set(vault, registry);
  }
  return registry;
}
