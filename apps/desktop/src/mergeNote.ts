// Merging a note into another: its text goes after the other's, its
// properties the other has not are added and lists both have are joined,
// and every link to it, in any note, is led to the other, keeping the
// heading or block it named, whose text came along. Then it goes to the
// trash. Both notes are read and the other is written through their
// documents, as the editor and sync have them, so neither loses an edit.
import type { JsonValue, NoteId, PropertyEntry } from "@nether/core";
import { documentProperties, setDocumentProperties } from "@nether/editor";
import { databaseKey } from "@nether/database";
import type { LinkGraph } from "@nether/graph";
import { relinkMarkdown } from "@nether/markdown";
import { ChangedOnDisk, type NoteEntry, type Vault } from "@nether/storage";
import { t } from "./messages.ts";
import { type NoteHold, noteDocuments, whenLoaded } from "./noteDocuments.ts";
import { decode, joinPath, linkNamer, relativeAddress } from "./renameNote.ts";

/** Frontmatter at the start of a note, as the parser finds it: a `---` line closed by another. */
const frontmatter = /^---[ \t]*\r?\n(?:[^]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** The other note's properties, with those only the merged note has added, and lists both have joined. */
export function mergedProperties(
  into: readonly PropertyEntry[],
  from: readonly PropertyEntry[],
): PropertyEntry[] {
  const merged = into.map((entry) => {
    const other = from.find((item) => item.key.toLowerCase() === entry.key.toLowerCase());
    if (other === undefined || !Array.isArray(entry.value) || !Array.isArray(other.value)) {
      return entry;
    }
    const own: readonly JsonValue[] = entry.value;
    const theirs: readonly JsonValue[] = other.value;
    const seen = new Set(own.map((item) => JSON.stringify(item)));
    const added = theirs.filter((item) => !seen.has(JSON.stringify(item)));
    return { key: entry.key, value: [...own, ...added] };
  });
  // A database's schema stays with its own note: merging a database into a note does not make it one.
  const keys = new Set(into.map((entry) => entry.key.toLowerCase()));
  const schema = (entry: PropertyEntry) =>
    entry.key === databaseKey &&
    typeof entry.value === "object" &&
    entry.value !== null &&
    !Array.isArray(entry.value);
  return [
    ...merged,
    ...from.filter((entry) => !keys.has(entry.key.toLowerCase()) && !schema(entry)),
  ];
}

/** A note's document, held and loaded, or why it cannot be merged. */
async function hold(vault: Vault, id: NoteId): Promise<NoteHold> {
  const held = noteDocuments(vault).open(id);
  await whenLoaded(held.note);
  const { state } = held.note.snapshot;
  if (state.status !== "ready" || state.frontmatterError !== undefined) {
    held.release();
    throw new Error(t("mergeCannotRead", { name: vault.note(id)?.title ?? "" }));
  }
  return held;
}

/** The note's text and properties, from a held note's document. */
function contents(held: NoteHold): { readonly text: string; readonly properties: PropertyEntry[] } {
  const { state } = held.note.snapshot;
  if (state.status !== "ready") throw new Error(t("missingNote"));
  return { text: state.text, properties: documentProperties(state.document) };
}

/**
 * Text with each link to `from` led to `to`, written in the note at `at`:
 * a wiki link by the shortest name that finds `to`, a Markdown link by the
 * path from there. With `movedFrom`, the text comes from the note at that
 * path, and its Markdown links to other files are led from `at` instead.
 */
function relinked(
  text: string,
  vault: Vault,
  graph: LinkGraph,
  from: NoteEntry,
  to: NoteEntry,
  at: string,
  movedFrom?: string,
): string {
  const name = linkNamer(vault);
  const files = new Set(vault.files());
  const written = movedFrom ?? at;
  return relinkMarkdown(text, (link) => {
    if (link.kind === "wiki") {
      return graph.resolve(link.target, written) === from.id
        ? name(link.target, to.path)
        : undefined;
    }
    const path = joinPath(folderOf(written), decode(link.target));
    if (path === undefined) return undefined;
    const spaces = text[link.start - 1] === "<" ? "raw" : "escaped";
    if (path === from.path) return relativeAddress(folderOf(at), to.path, spaces);
    if (movedFrom !== undefined && folderOf(movedFrom) !== folderOf(at) && files.has(path)) {
      return relativeAddress(folderOf(at), path, spaces);
    }
    return undefined;
  });
}

/** Merges the note `id` into the note `into`, and moves it to the trash. The link index must be up to date. */
export async function mergeNote(
  vault: Vault,
  graph: LinkGraph,
  id: NoteId,
  into: NoteId,
): Promise<void> {
  const from = vault.note(id);
  const to = vault.note(into);
  if (from === undefined || to === undefined) throw new Error(t("missingNote"));
  if (id === into) throw new Error(t("mergeIntoItself"));

  const source = await hold(vault, id);
  let target: NoteHold | undefined;
  try {
    target = await hold(vault, into);
    const merging = contents(source);

    // The notes that link to it, other than the two, are written as their files are.
    for (const backlink of graph.backlinks(id)) {
      const note = vault.note(backlink.source);
      if (note === undefined || note.id === id || note.id === into) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        const file = await vault.read(note.id);
        if (file.missing === true || file.binary === true) break;
        const next = relinked(file.text, vault, graph, from, to, note.path);
        if (next === file.text) break;
        try {
          await vault.write(note.id, next, file.hash);
          break;
        } catch (error) {
          // Changed since it was read: read it again, once.
          if (!(error instanceof ChangedOnDisk) || attempt === 1) throw error;
        }
      }
    }

    // Its text, without its frontmatter, after the other's; the other's own links to it now lead to itself.
    const body = relinked(
      merging.text.replace(frontmatter, ""),
      vault,
      graph,
      from,
      to,
      to.path,
      from.path,
    ).replace(/^\s+/, "");
    const { text: own } = contents(target);
    const kept = relinked(own, vault, graph, from, to, to.path).replace(/\s+$/, "");
    const joined = body === "" ? `${kept}\n` : `${kept}\n\n${body}`;
    target.note.editText(joined.endsWith("\n") ? joined : `${joined}\n`);
    await target.note.refresh();
    const { state } = target.note.snapshot;
    if (state.status === "ready") {
      setDocumentProperties(
        state.document,
        mergedProperties(documentProperties(state.document), merging.properties),
      );
    }
  } finally {
    target?.release();
    source.release();
  }
  await vault.remove(id);
}
