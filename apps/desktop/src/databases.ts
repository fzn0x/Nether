// The app's side of databases (ADR 0018): a database's rows, from the
// vault's notes and what the link index read of them; a row's value
// written to its file; and new databases and rows.
import type { JsonValue, NoteId } from "@nether/core";
import { type Row, databaseKey, rowFolder, rowsOf } from "@nether/database";
import type { LinkGraph } from "@nether/graph";
import { parseMarkdown, serializeMarkdown } from "@nether/markdown";
import { ChangedOnDisk, type NoteEntry, type Vault } from "@nether/storage";

/** A new database, as its note's frontmatter holds it: no properties yet, and a table. */
const newDatabase: JsonValue = {
  properties: [],
  views: [{ name: "Table", layout: "table", visible: [] }],
};

/** The rows of the database at `path`, with the properties the link index read of each. */
export function databaseRows(notes: readonly NoteEntry[], graph: LinkGraph, path: string): Row[] {
  return rowsOf(notes, path).map((note) => ({
    id: note.id,
    path: note.path,
    updated: note.modified,
    properties: graph.note(note.id)?.index.properties ?? [],
  }));
}

/** The link that names a note from anywhere: its path, without `.md`. */
export function linkToNote(graph: LinkGraph): (note: NoteId) => string {
  return (note) => `[[${(graph.note(note)?.path ?? note).replace(/\.md$/i, "")}]]`;
}

/** The note a link written in a property finds, from the note at `from`. */
export function resolveLink(graph: LinkGraph, from: string): (link: string) => NoteId | undefined {
  return (link) => graph.resolve(link.replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? "", from);
}

/** A path for a new note in a folder: its name, or with a number after it when that is taken. */
export function freePath(vault: Vault, folder: string, name: string): string {
  const prefix = folder === "" ? "" : `${folder}/`;
  for (let count = 1; ; count++) {
    const path = `${prefix}${count === 1 ? name : `${name} ${String(count)}`}.md`;
    if (vault.noteAt(path) === undefined) return path;
  }
}

/** Makes a database note in a folder, with a table and no properties. */
export async function createDatabase(
  vault: Vault,
  folder: string,
  name: string,
): Promise<NoteEntry> {
  const text = serializeMarkdown({
    properties: [{ key: databaseKey, value: newDatabase }],
    content: [],
  }).text;
  return vault.create(freePath(vault, folder, name), text);
}

/** Makes a row of the database at `path`: a note in the folder beside it. */
export async function createRow(vault: Vault, path: string, name: string): Promise<NoteEntry> {
  return vault.create(freePath(vault, rowFolder(path), name), "");
}

/**
 * Sets a property of a note that is not open, in its file's frontmatter,
 * changing nothing else there; null leaves the key with no value, as
 * Obsidian writes an empty property. Read again and retried when another
 * write lands first.
 */
export async function setNoteProperty(
  vault: Vault,
  id: NoteId,
  key: string,
  value: JsonValue,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const file = await vault.read(id);
    if (file.missing === true || file.binary === true) return;
    const parsed = parseMarkdown(file.text);
    if (parsed.frontmatterError !== undefined) throw new Error(parsed.frontmatterError);
    const properties = parsed.properties.some((entry) => entry.key === key)
      ? parsed.properties.map((entry) => (entry.key === key ? { key, value } : entry))
      : [...parsed.properties, { key, value }];
    const text = serializeMarkdown({ ...parsed, properties }, { source: parsed.source }).text;
    try {
      await vault.write(id, text, file.hash);
      return;
    } catch (error) {
      if (!(error instanceof ChangedOnDisk) || attempt >= 2) throw error;
    }
  }
}
