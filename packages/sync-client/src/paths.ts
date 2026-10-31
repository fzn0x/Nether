// The vault document (ADR 0037): the one Yjs document per workspace that
// lists its notes, each note's ID to its path, so a note made, moved or
// removed on one device is made, moved or removed on the others. A note's
// text is in its own document. A device knows what it and the server last
// agreed on, the base, so it can tell its own changes from the server's.

import * as Y from "yjs";

/** The notes of a vault: each note's ID, and its path. */
export type Paths = ReadonlyMap<string, string>;

/** The vault document's map of note IDs to paths. */
function notesOf(document: Y.Doc): Y.Map<string> {
  return document.getMap<string>("notes");
}

/** The notes the vault document lists. */
export function vaultPaths(document: Y.Doc): Map<string, string> {
  return new Map(notesOf(document).entries());
}

/** Lists a note at a path, or moves it there. */
export function setVaultPath(document: Y.Doc, id: string, path: string): void {
  const notes = notesOf(document);
  if (notes.get(id) !== path) notes.set(id, path);
}

export function removeVaultPath(document: Y.Doc, id: string): void {
  notesOf(document).delete(id);
}

/** What to do to bring this vault and the server's list together. */
export interface Plan {
  /** Notes made here: listed on the server, and their documents sent. */
  readonly upload: readonly string[];
  /** Notes made elsewhere: their documents fetched, and their files made here at these paths. */
  readonly download: readonly { readonly id: string; readonly path: string }[];
  /** Notes moved here, to move on the server. */
  readonly moveRemote: readonly { readonly id: string; readonly path: string }[];
  /** Notes moved elsewhere, to move here. */
  readonly moveLocal: readonly { readonly id: string; readonly path: string }[];
  /** Notes removed here, to remove from the server's list. */
  readonly removeRemote: readonly string[];
  /** Notes removed elsewhere, to send to the trash here. */
  readonly removeLocal: readonly string[];
}

/**
 * Compares this vault's notes and the server's list with what the two last
 * agreed on: a change on one side is made on the other; a note changed on
 * both, moved to two paths, goes where the server has it, as every device
 * then agrees. A note removed on one side and changed on the other is kept,
 * at its changed path: losing a note is worse than keeping one.
 */
export function reconcilePaths(base: Paths, local: Paths, remote: Paths): Plan {
  const upload: string[] = [];
  const download: { id: string; path: string }[] = [];
  const moveRemote: { id: string; path: string }[] = [];
  const moveLocal: { id: string; path: string }[] = [];
  const removeRemote: string[] = [];
  const removeLocal: string[] = [];

  for (const [id, here] of local) {
    const there = remote.get(id);
    const agreed = base.get(id);
    if (there === undefined) {
      // Not on the server: made here, or removed elsewhere, unless moved here since.
      if (agreed === undefined || agreed !== here) upload.push(id);
      else removeLocal.push(id);
    } else if (here !== there) {
      if (here === agreed) moveLocal.push({ id, path: there });
      else if (there === agreed) moveRemote.push({ id, path: here });
      else moveLocal.push({ id, path: there });
    }
  }
  for (const [id, there] of remote) {
    if (local.has(id)) continue;
    const agreed = base.get(id);
    // Not here: made elsewhere, or removed here, unless moved elsewhere since.
    if (agreed === undefined || agreed !== there) download.push({ id, path: there });
    else removeRemote.push(id);
  }
  return { upload, download, moveRemote, moveLocal, removeRemote, removeLocal };
}

/** Whether a plan changes nothing. */
export function isEmptyPlan(plan: Plan): boolean {
  return Object.values(plan).every((items: readonly unknown[]) => items.length === 0);
}
