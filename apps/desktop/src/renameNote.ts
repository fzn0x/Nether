// Renaming or moving a note, and every link to it with it. The links that
// named the note before it moved are rewritten to name it where it is, in
// each note that links to it and in the note itself: a wiki link by the
// shortest name that finds it, or by its path when it was written so, and
// a Markdown link by the path from where it is written. A note that moves
// to another folder has its own Markdown links led from there.
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import { type WrittenLink, findLinks, relinkMarkdown } from "@nether/markdown";
import { ChangedOnDisk, type NoteEntry, type Vault } from "@nether/storage";

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
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

/** What a note's links say before the move: which name the moving note, and which lead elsewhere from a moving note. */
interface Plan {
  readonly note: NoteId;
  readonly text: string;
  readonly hash: string;
  /** The starts of links that name the moving note. */
  readonly toMoved: ReadonlySet<number>;
  /** For the moving note's own Markdown links: the file each leads to, by its start. */
  readonly leadsTo: ReadonlyMap<number, string>;
}

/**
 * Moves a note to `path`, keeping its ID, and rewrites the links to it in
 * every note, and the moving note's own relative links, to match. The link
 * index must be up to date, so that it knows every note's links.
 */
export async function renameNote(
  vault: Vault,
  graph: LinkGraph,
  id: NoteId,
  path: string,
): Promise<NoteEntry> {
  const note = vault.note(id);
  if (note === undefined) throw new Error("The note is no longer in the vault.");
  const from = note.path;
  if (path === from) return note;
  const there = vault.noteAt(path);
  if (there !== undefined && there.id !== id) throw new Error(`A note is already at ${path}.`);

  // Before the move, while links still find the note where it was.
  const sources = [id, ...graph.backlinks(id).map((backlink) => backlink.source)];
  const plans: Plan[] = [];
  for (const source of new Set(sources)) {
    const entry = vault.note(source);
    if (entry === undefined) continue;
    const file = await vault.read(source);
    if (file.missing === true || file.binary === true) continue;
    const toMoved = new Set<number>();
    const leadsTo = new Map<number, string>();
    for (const link of findLinks(file.text)) {
      if (link.kind === "wiki") {
        if (graph.resolve(link.target, entry.path) === id) toMoved.add(link.start);
        continue;
      }
      const target = joinPath(folderOf(entry.path), decode(link.target));
      if (target === undefined) continue;
      if (target.toLowerCase() === from.toLowerCase()) toMoved.add(link.start);
      else if (source === id && vault.files().includes(target)) leadsTo.set(link.start, target);
    }
    if (toMoved.size > 0 || leadsTo.size > 0) {
      plans.push({ note: source, text: file.text, hash: file.hash, toMoved, leadsTo });
    }
  }

  const moved = await vault.rename(id, path);

  // The shortest name that finds the note: its name, unless another note has it.
  const name = nameOf(path);
  const shared = vault
    .notes()
    .some((other) => other.id !== id && other.title.toLowerCase() === name.toLowerCase());
  const wikiTarget = (written: string) => {
    const byPath = written.includes("/") || shared;
    const target = byPath ? path.replace(/\.md$/i, "") : name;
    return /\.md$/i.test(written) ? `${target}.md` : target;
  };

  for (const plan of plans) {
    const folder = folderOf(vault.note(plan.note)?.path ?? "");
    const relink = (
      text: string,
      named: (link: WrittenLink) => boolean,
      leadsTo: (link: WrittenLink) => string | undefined,
    ) =>
      relinkMarkdown(text, (link) => {
        // In angle brackets an address keeps its spaces; elsewhere it writes them as `%20`.
        const spaces = text[link.start - 1] === "<" ? "raw" : "escaped";
        if (named(link)) {
          return link.kind === "wiki"
            ? wikiTarget(link.target)
            : relativeAddress(folder, path, spaces);
        }
        const target = leadsTo(link);
        return target === undefined ? undefined : relativeAddress(folder, target, spaces);
      });
    const next = relink(
      plan.text,
      (link) => plan.toMoved.has(link.start),
      (link) => plan.leadsTo.get(link.start),
    );
    if (next === plan.text) continue;
    try {
      await vault.write(plan.note, next, plan.hash);
    } catch (error) {
      if (!(error instanceof ChangedOnDisk)) throw error;
      // Changed since it was read: relink the links written as those that named the note then.
      const named = new Set(
        findLinks(plan.text)
          .filter((link) => plan.toMoved.has(link.start))
          .map((link) => `${link.kind}:${link.target}`),
      );
      const file = await vault.read(plan.note);
      if (file.missing === true || file.binary === true) continue;
      const again = relink(
        file.text,
        (link) => named.has(`${link.kind}:${link.target}`),
        () => undefined,
      );
      if (again !== file.text) await vault.write(plan.note, again, file.hash);
    }
  }
  return moved;
}
