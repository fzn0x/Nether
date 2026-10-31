// The vault as the sync engine sees it in the desktop app (ADR 0037): its
// notes, and the documents its open notes share with the editor. It loads
// with the engine, only for a vault linked to a workspace.
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
    return this.#vault.subscribe(() => {
      const next = snapshot();
      let listed = next.size !== last.size;
      for (const [id, entry] of next) {
        const before = last.get(id);
        if (before === undefined || before.split("\n")[0] !== entry.split("\n")[0]) listed = true;
        else if (before !== entry) listener(id);
      }
      last = next;
      if (listed) listener();
    });
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
}
