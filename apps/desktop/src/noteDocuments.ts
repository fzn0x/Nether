// A vault's open notes, as ADR 0003 has them: a note's Yjs document is the
// truth inside Nether, kept in the vault's index before an edit counts as
// saved, and its file is kept in step both ways. Edits are written to the
// file after a pause in typing, keeping every unchanged block's bytes. An
// edit another app makes to the file is merged into the document, block by
// block and character by character, so neither side's edits are lost.
// Source mode's text is written as typed, then merged into the document the
// same way.
//
// Whoever needs a note's document, the editor or sync, opens it here, and
// everyone holding a note shares its one document; the last to let it go
// saves it and closes it.
import { type ContentBlock, type NoteId, type PropertyEntry, newBlockId } from "@nether/core";
import {
  documentBlocks,
  documentProperties,
  isEmptyDocument,
  setDocumentBlocks,
  setDocumentProperties,
} from "@nether/editor";
import {
  type ParsedMarkdown,
  alignBlocks,
  fingerprint,
  mergeBlocks,
  mergeProperties,
  parseMarkdown,
  serializeMarkdown,
} from "@nether/markdown";
import { ChangedOnDisk, type Vault } from "@nether/storage";
import * as Y from "yjs";

/** Quiet time before a save, and the longest an edit waits while typing goes on. */
const quiet = 500;
const longest = 2000;
/** How often the document's updates go to the index, and how many rows it keeps before a snapshot. */
const persistEvery = 250;
const compactAfter = 100;

/** The origin of the document's edits that come from the note's file. */
const fromFile = Symbol("file");

export type NoteState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      /** The note's Yjs document, which the block editor edits. */
      readonly document: Y.Doc;
      /** The note's Markdown, as source mode shows it. */
      readonly text: string;
      /** Why the note's frontmatter cannot be read, when it cannot: its properties then stay as they are. */
      readonly frontmatterError?: string;
      /** Changes whenever the note's text is read again, to start source mode anew. */
      readonly version: number;
    }
  | { readonly status: "binary" }
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly error: Error };

/** What a note's holders see of it: its state, and why its last save failed, if it did. */
export interface NoteSnapshot {
  readonly state: NoteState;
  readonly saveError: string | undefined;
}

function sameProperties(a: readonly PropertyEntry[], b: readonly PropertyEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameBlocks(a: readonly ContentBlock[], b: readonly ContentBlock[]): boolean {
  return (
    a.length === b.length &&
    a.every((block, index) => {
      const other = b[index];
      return block.id === other?.id && fingerprint(block) === fingerprint(other);
    })
  );
}

/** A note's document while it is loaded. */
interface Loaded {
  readonly document: Y.Doc;
  /** The file as last written or read: its parse, aligned to the document's IDs. */
  file: ParsedMarkdown;
  /** The hash of the file as last written or read. */
  hash: string;
  /** Whether the document has changed since the file was last written. */
  dirty: boolean;
  /** Source mode's text, waiting to be written. */
  text: string | undefined;
  firstPending: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  saving: Promise<void> | undefined;
  /** The document's updates waiting for the index; the number of the last stored, and the rows kept. */
  updates: Uint8Array[];
  seq: number;
  rows: number;
  persisting: Promise<void>;
  persistTimer: ReturnType<typeof setTimeout> | undefined;
  closed: boolean;
}

/** Whether a note has edits waiting for its file: text from source mode, or the document's. */
function waiting(note: Loaded): boolean {
  return note.dirty || note.text !== undefined;
}

/** One note's document, open for whoever holds it. */
export class OpenNote {
  readonly id: NoteId;
  readonly #vault: Vault;
  #snapshot: NoteSnapshot = { state: { status: "loading" }, saveError: undefined };
  readonly #listeners = new Set<() => void>();
  #loaded: Loaded | undefined;
  #version = 0;
  #closing = false;
  #unwatch: (() => void) | undefined;

  constructor(vault: Vault, id: NoteId, after: Promise<void>) {
    this.#vault = vault;
    this.id = id;
    void after.then(() => this.#load());
  }

  get snapshot(): NoteSnapshot {
    return this.#snapshot;
  }

  /** Calls `listener` whenever the snapshot changes; gives the way to stop. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Takes source mode's text after a change and saves it after a pause. */
  editText(text: string): void {
    const current = this.#loaded;
    if (current === undefined) return;
    current.text = text;
    this.#schedule(current);
  }

  /**
   * Saves what is waiting, then gives the note as saved to a new editor:
   * the other mode's, when the user switches between blocks and source.
   */
  async refresh(): Promise<void> {
    const current = this.#loaded;
    if (current === undefined) return;
    await this.#flush(current);
    if (this.#loaded === current) this.#ready(current);
  }

  /** Saves what is waiting at once, then lets the document go. */
  async close(): Promise<void> {
    this.#closing = true;
    this.#unwatch?.();
    const current = this.#loaded;
    if (current === undefined) return;
    this.#loaded = undefined;
    await this.#flush(current);
    current.closed = true;
    clearTimeout(current.timer);
    await this.#persist(current);
    current.document.destroy();
  }

  /** Whether the note has begun to close; read anew after each wait. */
  #isClosing(): boolean {
    return this.#closing;
  }

  #set(next: Partial<NoteSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...next };
    for (const listener of this.#listeners) listener();
  }

  #ready(current: Loaded): void {
    this.#version += 1;
    this.#set({
      state: {
        status: "ready",
        document: current.document,
        text: current.file.source.text,
        version: this.#version,
        ...(current.file.frontmatterError === undefined
          ? {}
          : { frontmatterError: current.file.frontmatterError }),
      },
    });
  }

  async #load(): Promise<void> {
    const vault = this.#vault;
    const id = this.id;
    try {
      const file = await vault.read(id);
      if (this.#isClosing()) return;
      if (file.missing === true) {
        this.#set({ state: { status: "missing" } });
        return;
      }
      if (file.binary === true) {
        this.#set({ state: { status: "binary" } });
        return;
      }
      const stored = await vault.documents.document(id);
      if (this.#isClosing()) return;
      const document = new Y.Doc();
      for (const update of stored.updates) Y.applyUpdate(document, update.data);
      const parsed = parseMarkdown(file.text);
      const current: Loaded = {
        document,
        file: parsed,
        hash: file.hash,
        dirty: false,
        text: undefined,
        firstPending: undefined,
        timer: undefined,
        saving: undefined,
        updates: [],
        seq: stored.updates[stored.updates.length - 1]?.seq ?? 0,
        rows: stored.updates.length,
        persisting: Promise.resolve(),
        persistTimer: undefined,
        closed: false,
      };
      // From here on, every change to the document goes to the index.
      document.on("update", (update: Uint8Array) => {
        current.updates.push(update);
        current.persistTimer ??= setTimeout(() => void this.#persist(current), persistEvery);
      });
      if (isEmptyDocument(document)) {
        // A note opened for the first time: its document starts from its file.
        document.transact(() => {
          setDocumentBlocks(document, parsed.content, fromFile);
          setDocumentProperties(document, parsed.properties, fromFile);
        }, fromFile);
      } else {
        const ours = documentBlocks(document, newBlockId);
        const aligned = alignBlocks(parsed, ours);
        current.file = aligned;
        if (stored.fileHash === file.hash) {
          // The file is the document's last write: edits it lacks, as after a crash, are written.
          current.dirty =
            !sameBlocks(ours, aligned.content) ||
            (aligned.frontmatterError === undefined &&
              !sameProperties(documentProperties(document), aligned.properties));
        } else {
          // Another app changed the file while the note was closed.
          document.transact(() => {
            setDocumentBlocks(document, aligned.content, fromFile);
            setDocumentProperties(document, aligned.properties, fromFile);
          }, fromFile);
        }
      }
      void vault.documents.setFileHash(id, file.hash);
      this.#loaded = current;
      // Edits that do not come from the file, the editor's or sync's, are
      // written to it after a pause.
      document.on("update", (_update: Uint8Array, origin: unknown) => {
        if (origin === fromFile) return;
        current.dirty = true;
        this.#schedule(current);
      });
      if (current.dirty) this.#schedule(current);
      this.#watch();
      this.#ready(current);
    } catch (error) {
      if (!this.#isClosing()) {
        this.#set({
          state: {
            status: "failed",
            error: error instanceof Error ? error : new Error(String(error)),
          },
        });
      }
    }
  }

  /** When another app changes the file, merges its edit into the document. */
  #watch(): void {
    const vault = this.#vault;
    const id = this.id;
    let modified = vault.note(id)?.modified;
    this.#unwatch = vault.subscribe(() => {
      const note = vault.note(id);
      if (note === undefined) {
        this.#set({ state: { status: "missing" } });
        return;
      }
      if (note.modified === modified) return;
      modified = note.modified;
      const current = this.#loaded;
      if (current === undefined || current.saving !== undefined) return;
      void vault.read(id).then((file) => {
        if (
          file.missing === true ||
          file.binary === true ||
          file.hash === current.hash ||
          this.#loaded !== current
        ) {
          return;
        }
        this.#mergeFile(current, file.text, file.hash);
        if (current.dirty) this.#schedule(current);
        // Source mode shows the file as it is now, unless typing is waiting to be saved.
        if (current.text === undefined) this.#ready(current);
      });
    });
  }

  /** Sends the document's waiting updates to the index as one row, and compacts it now and then. */
  #persist(current: Loaded): Promise<void> {
    clearTimeout(current.persistTimer);
    current.persistTimer = undefined;
    current.persisting = current.persisting.then(async () => {
      if (current.updates.length === 0) return;
      const batch = Y.mergeUpdates(current.updates);
      current.updates = [];
      await this.#vault.documents.appendUpdates(this.id, [batch]);
      current.seq += 1;
      current.rows += 1;
      if (current.rows > compactAfter) {
        await this.#vault.documents.compact(
          this.id,
          Y.encodeStateAsUpdate(current.document),
          current.seq,
        );
        current.rows = 1;
      }
    });
    return current.persisting;
  }

  /**
   * Merges the file's text as it is now into the document: what changed in
   * it since it was last written or read joins what changed in the document.
   */
  #mergeFile(current: Loaded, text: string, hash: string): void {
    const theirs = alignBlocks(parseMarkdown(text), current.file.content);
    const ours = documentBlocks(current.document, newBlockId);
    const merged = mergeBlocks(current.file.content, ours, theirs.content, newBlockId);
    // Properties merge key by key; a frontmatter that cannot be read keeps its own.
    const properties =
      theirs.frontmatterError === undefined
        ? mergeProperties(
            current.file.properties,
            documentProperties(current.document),
            theirs.properties,
          )
        : theirs.properties;
    current.document.transact(() => {
      setDocumentBlocks(current.document, merged, fromFile);
      setDocumentProperties(current.document, properties, fromFile);
    }, fromFile);
    current.file = theirs;
    current.hash = hash;
    // What the file lacks of the document is written back.
    current.dirty =
      !sameBlocks(merged, theirs.content) || !sameProperties(properties, theirs.properties);
    void this.#vault.documents.setFileHash(this.id, hash);
  }

  /** Writes what is waiting to the file: source mode's text, or the document. */
  async #flush(current: Loaded): Promise<void> {
    if (!waiting(current)) return;
    if (current.saving !== undefined) {
      await current.saving;
      return this.#flush(current);
    }
    const vault = this.#vault;
    clearTimeout(current.timer);
    current.firstPending = undefined;
    const bom = current.file.source.bom ? "\uFEFF" : "";
    const typed = current.text;
    current.text = undefined;
    current.dirty = false;
    const blocks = typed === undefined ? documentBlocks(current.document, newBlockId) : undefined;
    const text =
      blocks === undefined
        ? bom + (typed ?? "")
        : serializeMarkdown(
            {
              // A frontmatter that cannot be read keeps its own properties.
              properties:
                current.file.frontmatterError === undefined
                  ? documentProperties(current.document)
                  : current.file.properties,
              content: blocks,
            },
            { source: current.file.source, writeIds: current.file.writtenIds },
          ).text;
    if (text === bom + current.file.source.text) return;
    current.saving = (async () => {
      try {
        const written = await vault.write(this.id, text, current.hash);
        if (blocks === undefined) {
          // Source mode's text, merged into the document as the file it now is.
          this.#mergeFile(current, written.text, written.hash);
        } else {
          current.file = alignBlocks(parseMarkdown(written.text), blocks);
          current.hash = written.hash;
          await vault.documents.setFileHash(this.id, written.hash);
        }
        this.#set({ saveError: undefined });
      } catch (error) {
        if (error instanceof ChangedOnDisk) {
          // Another app changed the file since it was read: merge its edit
          // into the document, then write the document.
          const disk = await vault.read(this.id);
          if (disk.missing !== true && disk.binary !== true) {
            this.#mergeFile(current, disk.text, disk.hash);
            if (typed !== undefined) {
              // Then the text typed in source mode, against the file it was typed over.
              const theirs = alignBlocks(parseMarkdown(bom + typed), current.file.content);
              const merged = mergeBlocks(
                current.file.content,
                documentBlocks(current.document, newBlockId),
                theirs.content,
                newBlockId,
              );
              setDocumentBlocks(current.document, merged, fromFile);
            }
            current.dirty = true;
          }
        } else {
          if (typed === undefined) current.dirty = true;
          else current.text ??= typed;
          this.#set({ saveError: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        current.saving = undefined;
      }
    })();
    await current.saving;
    // Edits made, or merged, while the file was being written.
    if (waiting(current) && !current.closed) await this.#flush(current);
  }

  /** Saves after a pause, or soon while typing goes on. */
  #schedule(current: Loaded): void {
    const now = Date.now();
    current.firstPending ??= now;
    clearTimeout(current.timer);
    const wait = Math.max(0, Math.min(quiet, current.firstPending + longest - now));
    current.timer = setTimeout(() => void this.#flush(current), wait);
  }
}

/** A hold on an open note; let it go when done. */
export interface NoteHold {
  readonly note: OpenNote;
  release(): void;
}

interface Entry {
  readonly note: OpenNote;
  holders: number;
  closeTimer: ReturnType<typeof setTimeout> | undefined;
}

/** A vault's open notes, each shared by everyone holding it. */
export class NoteDocuments {
  readonly #vault: Vault;
  readonly #open = new Map<NoteId, Entry>();
  /** Notes closing, which open again only once their last save is done. */
  readonly #closing = new Map<NoteId, Promise<void>>();

  constructor(vault: Vault) {
    this.#vault = vault;
  }

  /** Opens a note, or holds the one already open. */
  open(id: NoteId): NoteHold {
    let entry = this.#open.get(id);
    if (entry === undefined) {
      entry = {
        note: new OpenNote(this.#vault, id, this.#closing.get(id) ?? Promise.resolve()),
        holders: 0,
        closeTimer: undefined,
      };
      this.#open.set(id, entry);
    }
    const held = entry;
    held.holders += 1;
    clearTimeout(held.closeTimer);
    held.closeTimer = undefined;
    let released = false;
    return {
      note: held.note,
      release: () => {
        if (released) return;
        released = true;
        held.holders -= 1;
        if (held.holders > 0) return;
        // A moment later, so a hold let go and taken again at once, as React
        // does in development, keeps the note open.
        held.closeTimer = setTimeout(() => {
          if (held.holders > 0 || this.#open.get(id) !== held) return;
          this.#open.delete(id);
          const closed = held.note.close().finally(() => {
            if (this.#closing.get(id) === closed) this.#closing.delete(id);
          });
          this.#closing.set(id, closed);
        }, 0);
      },
    };
  }
}

const registries = new WeakMap<Vault, NoteDocuments>();

/** The open notes of a vault. */
export function noteDocuments(vault: Vault): NoteDocuments {
  let registry = registries.get(vault);
  if (registry === undefined) {
    registry = new NoteDocuments(vault);
    registries.set(vault, registry);
  }
  return registry;
}
