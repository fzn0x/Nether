// The vault as the sync engine sees it in the desktop app (ADR 0037): its
// notes, the documents its open notes share with the editor, and its other
// files (ADR 0040). It loads with the engine, only for a vault linked to a
// workspace.
import { type NoteId, newBlockId } from "@nether/core";
import { documentBlocks, documentProperties } from "@nether/editor";
import { serializeMarkdown } from "@nether/markdown";
import { type Vault, numberedPath } from "@nether/storage";
import type { HeldDocument, SyncVault } from "@nether/sync-client";
import * as Y from "yjs";
import type { NoteDocuments } from "./noteDocuments.ts";

/** The first path like `path` that no note has, but `id`'s own. */
function freePath(vault: Vault, path: string, id: string): string {
  for (let n = 1; ; n++) {
    const candidate = numberedPath(path, n);
    const taken = vault.noteAt(candidate);
    if (taken === undefined || taken.id === id) return candidate;
  }
}

/** The vault as the sync engine sees it. */
export class DesktopSyncVault implements SyncVault {
  readonly #vault: Vault;
  readonly #documents: NoteDocuments;

  constructor(vault: Vault, documents: NoteDocuments) {
    this.#vault = vault;
    this.#documents = documents;
  }

  paths(): Map<string, string> {
    return new Map(this.#vault.notes().map((note) => [note.id, note.path]));
  }

  watch(listener: (id?: string) => void): () => void {
    const snapshot = () =>
      new Map(
        this.#vault.notes().map((note) => [note.id, `${note.path}\n${String(note.modified)}`]),
      );
    let last = snapshot();
    let lastFiles = this.#filesSnapshot();
    return this.#vault.subscribe(() => {
      const next = snapshot();
      let listed = next.size !== last.size;
      for (const [id, entry] of next) {
        const before = last.get(id);
        if (before === undefined || before.split("\n")[0] !== entry.split("\n")[0]) listed = true;
        else if (before !== entry) listener(id);
      }
      last = next;
      const files = this.#filesSnapshot();
      if (files !== lastFiles) listed = true;
      lastFiles = files;
      if (listed) listener();
    });
  }

  /** The vault's other files, with their sizes and times, as one text to compare. */
  #filesSnapshot(): string {
    return this.#vault
      .attachments()
      .sort()
      .map((path) => {
        const info = this.#vault.fileInfo(path);
        return `${path}\n${String(info?.size)}\n${String(info?.modified)}`;
      })
      .join("\n");
  }

  /** Holds the note's document as the editor does, once it has loaded. */
  async hold(id: string): Promise<HeldDocument> {
    const hold = this.#documents.open(id as NoteId);
    const { note } = hold;
    await new Promise<void>((resolve) => {
      if (note.snapshot.state.status !== "loading") {
        resolve();
        return;
      }
      const stop = note.subscribe(() => {
        if (note.snapshot.state.status === "loading") return;
        stop();
        resolve();
      });
    });
    const { state } = note.snapshot;
    if (state.status !== "ready") {
      hold.release();
      throw new Error(`The note ${id} cannot be synced: it is ${state.status}.`);
    }
    return {
      document: state.document,
      release: () => {
        hold.release();
      },
    };
  }

  /**
   * Makes a note the server has: its document's state goes to the index
   * first, then its file is written from it, so the document is never made
   * again from the file.
   */
  async create(id: string, path: string, state: Uint8Array): Promise<void> {
    const document = new Y.Doc();
    Y.applyUpdate(document, state);
    const text = serializeMarkdown({
      properties: documentProperties(document),
      content: documentBlocks(document, newBlockId),
    }).text;
    document.destroy();
    const note = id as NoteId;
    await this.#vault.documents.appendUpdates(note, [state]);
    const made = await this.#vault.create(freePath(this.#vault, path, id), text, note);
    const file = await this.#vault.read(made.id);
    if (file.missing !== true) await this.#vault.documents.setFileHash(made.id, file.hash);
  }

  async move(id: string, path: string): Promise<void> {
    const note = this.#vault.note(id as NoteId);
    if (note === undefined) return;
    const target = freePath(this.#vault, path, id);
    if (target !== note.path) await this.#vault.rename(note.id, target);
  }

  async remove(id: string): Promise<void> {
    if (this.#vault.note(id as NoteId) !== undefined) await this.#vault.remove(id as NoteId);
  }

  /** The vault's other files and their hashes, from the index where it knows them. */
  async files(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    for (const path of this.#vault.attachments()) {
      const hash = await this.#vault.fileHash(path);
      if (hash !== undefined) files.set(path, hash);
    }
    return files;
  }

  readFile(path: string): Promise<{ bytes: Uint8Array; hash: string }> {
    return this.#vault.readBytes(path);
  }

  async writeFile(path: string, data: Uint8Array, base: string): Promise<void> {
    await this.#vault.writeBytes(path, data, base);
  }

  moveFile(from: string, to: string): Promise<void> {
    return this.#vault.moveFile(from, to);
  }

  async removeFile(path: string): Promise<void> {
    if (this.#vault.fileInfo(path) !== undefined) await this.#vault.removeFile(path);
  }
}
