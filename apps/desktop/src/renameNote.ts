// Renaming and moving notes, and every link to them with them. Moving a
// page takes the folder of its pages along, and moving a folder takes all
// it holds, images and other files too. The links that named a moved note
// or file before the move are rewritten to name it where it is, in each
// note that links to a moved note and in the moved notes themselves: a
// wiki link by the shortest name that finds it, or by its path when it was
// written so, and a Markdown link by the path from where it is written. A
// note that moves to another folder has its own Markdown links led from
// there.
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import { type WrittenLink, findLinks, relinkMarkdown } from "@nether/markdown";
import { ChangedOnDisk, type NoteEntry, type Vault, isNotePath } from "@nether/storage";

/** A file moving from one path to another. */
export interface Move {
  readonly from: string;
  readonly to: string;
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A path relative to a folder, `..` and `.` taken out; undefined when it leaves the vault. */
function joinPath(folder: string, relative: string): string | undefined {
  const parts = folder === "" ? [] : folder.split("/");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** The path from a note's folder to a file, as a Markdown link writes it. */
function relativeAddress(from: string, to: string, spaces: "raw" | "escaped"): string {
  const fromFolders = from === "" ? [] : from.split("/");
  const toParts = to.split("/");
  let common = 0;
  while (
    common < fromFolders.length &&
    common < toParts.length - 1 &&
    fromFolders[common] === toParts[common]
  ) {
    common++;
  }
  const address = [
    ...Array.from({ length: fromFolders.length - common }, () => ".."),
    ...toParts.slice(common),
  ].join("/");
  return spaces === "raw" ? address : address.replace(/ /g, "%20");
}

/** Characters a note's name cannot have, for a file's sake on any system, or a link's. */
const unsafe = /[\\/:*?"<>|#^[\]]/;

/**
 * The path a note takes when renamed in its folder, or why the name cannot
 * be one: `empty`, or `unsafe` for a character a file or link cannot have,
 * or a dot to start it.
 */
export function renamedPath(
  path: string,
  name: string,
): { readonly path: string } | { readonly error: "empty" | "unsafe" } {
  const clean = name.trim().replace(/\.md$/i, "");
  if (clean === "") return { error: "empty" };
  if (unsafe.test(clean) || clean.startsWith(".")) return { error: "unsafe" };
  const folder = folderOf(path);
  return { path: `${folder === "" ? "" : `${folder}/`}${clean}.md` };
}

/** The folder of a page's pages: the folder beside the note with its name, as `Plan/` beside `Plan.md`. */
export function pagesFolder(path: string): string {
  return path.replace(/\.md$/i, "");
}

/** The moves that put every file in `folder`, at any depth, in `to` instead. */
export function folderMoves(vault: Vault, folder: string, to: string): Move[] {
  return vault
    .files()
    .filter((path) => path.startsWith(`${folder}/`))
    .map((path) => ({ from: path, to: `${to}${path.slice(folder.length)}` }));
}

/** The moves that put a note at `to` with its pages, those in the folder beside it, following it. */
export function pageMoves(vault: Vault, from: string, to: string): Move[] {
  return [{ from, to }, ...folderMoves(vault, pagesFolder(from), pagesFolder(to))];
}

/** What a note's links say before the move: for each link that must change, by its start, the file it names. */
interface Plan {
  readonly note: NoteId;
  readonly text: string;
  readonly hash: string;
  readonly targets: ReadonlyMap<number, string>;
}

/**
 * Moves files, notes and others, and rewrites the links to the moved notes
 * and files in every note that links to a moved note, and the moved notes'
 * own relative links. A note keeps its ID. The link index must be up to
 * date, so that it knows every note's links.
 */
export async function moveFiles(
  vault: Vault,
  graph: LinkGraph,
  moves: readonly Move[],
): Promise<void> {
  const real = moves.filter((move) => move.from !== move.to);
  if (real.length === 0) return;
  const destination = new Map(real.map((move) => [move.from, move.to]));
  const existing = new Set(vault.files().map((path) => path.toLowerCase()));
  for (const move of real) {
    if (
      existing.has(move.to.toLowerCase()) &&
      !destination.has(move.to) &&
      move.from.toLowerCase() !== move.to.toLowerCase()
    ) {
      throw new Error(`A file is already at ${move.to}.`);
    }
  }
  const movedNotes = new Map<NoteId, string>();
  for (const move of real) {
    const note = vault.noteAt(move.from);
    if (note !== undefined) movedNotes.set(note.id, move.to);
  }

  // Before the move, while links still find what they name where it was.
  const sources = new Set<NoteId>(movedNotes.keys());
  for (const id of movedNotes.keys()) {
    for (const backlink of graph.backlinks(id)) sources.add(backlink.source);
  }
  const files = new Set(vault.files());
  const plans: Plan[] = [];
  for (const source of sources) {
    const entry = vault.note(source);
    if (entry === undefined) continue;
    const file = await vault.read(source);
    if (file.missing === true || file.binary === true) continue;
    const moving =
      movedNotes.has(source) && folderOf(movedNotes.get(source) ?? "") !== folderOf(entry.path);
    const targets = new Map<number, string>();
    for (const link of findLinks(file.text)) {
      if (link.kind === "wiki") {
        const note = graph.resolve(link.target, entry.path);
        const notePath = note === undefined ? undefined : movedNotes.get(note);
        if (notePath !== undefined) {
          targets.set(link.start, notePath);
          continue;
        }
        if (note !== undefined) continue;
        // A link to a file, such as an embedded image.
        const path = vault.resolveFile(link.target, entry.path);
        const to = path === undefined ? undefined : destination.get(path);
        if (to !== undefined && !isNotePath(to)) targets.set(link.start, to);
        continue;
      }
      const path = joinPath(folderOf(entry.path), decode(link.target));
      if (path === undefined) continue;
      const to = destination.get(path);
      if (to !== undefined) targets.set(link.start, to);
      // A note moving to another folder leads its links to files staying where they are.
      else if (moving && files.has(path)) targets.set(link.start, path);
    }
    if (targets.size > 0) plans.push({ note: source, text: file.text, hash: file.hash, targets });
  }

  for (const move of real) await vault.moveFile(move.from, move.to);

  // The shortest name that finds a note or file: its name, unless another has it.
  const notes = vault.notes();
  const allFiles = vault.files();
  const wikiTarget = (written: string, path: string) => {
    if (isNotePath(path)) {
      const name = baseName(path).replace(/\.md$/i, "");
      const id = vault.noteAt(path)?.id;
      const shared = notes.some(
        (other) => other.id !== id && other.title.toLowerCase() === name.toLowerCase(),
      );
      const target = written.includes("/") || shared ? path.replace(/\.md$/i, "") : name;
      return /\.md$/i.test(written) ? `${target}.md` : target;
    }
    const name = baseName(path);
    const shared = allFiles.some(
      (other) => other !== path && baseName(other).toLowerCase() === name.toLowerCase(),
    );
    return written.includes("/") || shared ? path : name;
  };

  for (const plan of plans) {
    const folder = folderOf(vault.note(plan.note)?.path ?? "");
    const relink = (text: string, target: (link: WrittenLink) => string | undefined) =>
      relinkMarkdown(text, (link) => {
        const path = target(link);
        if (path === undefined) return undefined;
        if (link.kind === "wiki") return wikiTarget(link.target, path);
        // In angle brackets an address keeps its spaces; elsewhere it writes them as `%20`.
        return relativeAddress(folder, path, text[link.start - 1] === "<" ? "raw" : "escaped");
      });
    const next = relink(plan.text, (link) => plan.targets.get(link.start));
    if (next === plan.text) continue;
    try {
      await vault.write(plan.note, next, plan.hash);
    } catch (error) {
      if (!(error instanceof ChangedOnDisk)) throw error;
      // Changed since it was read: relink the links written as those that named a moved file then.
      const named = new Map<string, string>();
      for (const link of findLinks(plan.text)) {
        const path = plan.targets.get(link.start);
        if (path !== undefined) named.set(`${link.kind}:${link.target}`, path);
      }
      const file = await vault.read(plan.note);
      if (file.missing === true || file.binary === true) continue;
      const again = relink(file.text, (link) => named.get(`${link.kind}:${link.target}`));
      if (again !== file.text) await vault.write(plan.note, again, file.hash);
    }
  }
}

/**
 * Moves a note to `path`, keeping its ID, and rewrites the links to it in
 * every note, and its own relative links, to match.
 */
export async function renameNote(
  vault: Vault,
  graph: LinkGraph,
  id: NoteId,
  path: string,
): Promise<NoteEntry> {
  const note = vault.note(id);
  if (note === undefined) throw new Error("The note is no longer in the vault.");
  if (path === note.path) return note;
  const there = vault.noteAt(path);
  if (there !== undefined && there.id !== id) throw new Error(`A note is already at ${path}.`);
  await moveFiles(vault, graph, [{ from: note.path, to: path }]);
  const moved = vault.note(id);
  if (moved === undefined) throw new Error("The note is no longer in the vault.");
  return moved;
}
