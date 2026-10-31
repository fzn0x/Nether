// The app's side of databases (ADR 0018): a database's rows, and the
// notes a query block reads (ADR 0021), from the vault's notes and what
// the link index read of them; a row's value written to its file; and new
// databases and rows.
import type { DatabaseSchema, JsonValue, NoteId } from "@nether/core";
import {
  type Row,
  basePath,
  databaseKey,
  readBase,
  rowFolder,
  rowsOf,
  writeBase,
} from "@nether/database";
import type { GraphNote, LinkGraph } from "@nether/graph";
import { parseMarkdown, serializeMarkdown } from "@nether/markdown";
import { ChangedOnDisk, type NoteEntry, type Vault } from "@nether/storage";
import type { VaultMedia } from "./backend.ts";

/** A new database, as its note's frontmatter holds it: no properties yet, and a table. */
const newDatabase: JsonValue = {
  properties: [],
  views: [{ name: "Table", layout: "table", visible: [] }],
};

/** A note as a row, with the properties and tags the link index read of it. */
function rowOf(note: NoteEntry, graph: LinkGraph): Row {
  const index = graph.note(note.id)?.index;
  return {
    id: note.id,
    path: note.path,
    updated: note.modified,
    properties: index?.properties ?? [],
    tags: index?.tags ?? [],
  };
}

/** The rows of the database at `path`, with the properties the link index read of each. */
export function databaseRows(notes: readonly NoteEntry[], graph: LinkGraph, path: string): Row[] {
  return rowsOf(notes, path).map((note) => rowOf(note, graph));
}

/** Every note of the vault as a row, for a query block to find among. */
export function queryNotes(notes: readonly NoteEntry[], graph: LinkGraph): Row[] {
  return notes.map((note) => rowOf(note, graph));
}

/**
 * The address of the image a value names, as a gallery's cover or a
 * card's image: a web address, or a file of the vault linked from `from`.
 */
export function imageUrl(
  vault: Vault,
  media: VaultMedia,
  value: JsonValue | undefined,
  from: string,
): string | undefined {
  const values: readonly JsonValue[] = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  const first = values[0];
  if (typeof first !== "string" || first.trim() === "") return undefined;
  const link =
    first
      .trim()
      .replace(/^!?\[\[|\]\]$/g, "")
      .split("|")[0] ?? "";
  if (/^https?:\/\//i.test(link)) return link;
  const file = vault.resolveFile(link, from);
  return file === undefined ? undefined : media.url(file);
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
export function setNoteProperty(
  vault: Vault,
  id: NoteId,
  key: string,
  value: JsonValue,
): Promise<void> {
  return updateNoteProperty(vault, id, key, () => value);
}

/**
 * A list's value with an edit made to it from `base`, as a cell showed it,
 * made to the list as it is now instead: the items the edit added, after
 * those the list keeps, and without those it removed. A list cell shows a
 * row as the link index last read it, so two adds made one after another,
 * before the index reads the first, both land.
 */
export function mergeList(
  current: JsonValue | undefined,
  base: readonly JsonValue[],
  next: readonly JsonValue[],
): JsonValue[] {
  const key = (item: JsonValue) => JSON.stringify(item);
  const before = new Set(base.map(key));
  const after = new Set(next.map(key));
  const now: readonly JsonValue[] = Array.isArray(current)
    ? current
    : current === undefined || current === null
      ? []
      : [current];
  const kept = now.filter((item) => !before.has(key(item)) || after.has(key(item)));
  const have = new Set(kept.map(key));
  return [...kept, ...next.filter((item) => !before.has(key(item)) && !have.has(key(item)))];
}

/**
 * Changes a property of a note that is not open, from its value in the
 * file as it is now, so that two changes made one after another both land;
 * `next` returning undefined leaves the file as it is.
 */
export async function updateNoteProperty(
  vault: Vault,
  id: NoteId,
  key: string,
  next: (current: JsonValue | undefined) => JsonValue | undefined,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const file = await vault.read(id);
    if (file.missing === true || file.binary === true) return;
    const parsed = parseMarkdown(file.text);
    if (parsed.frontmatterError !== undefined) throw new Error(parsed.frontmatterError);
    const value = next(parsed.properties.find((entry) => entry.key === key)?.value);
    if (value === undefined) return;
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

/** The hash of each base Nether last wrote, by its database's path, kept in `.nether/bases.json`. */
async function writtenBases(vault: Vault): Promise<Record<string, string>> {
  const data = await vault.readData("bases");
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  return Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/**
 * Keeps the Obsidian base beside a database in step with its schema (ADR
 * 0018). What Obsidian changed in the base since Nether last wrote it,
 * or in a base Nether did not write, comes back to the schema through
 * `save`; then the base is written from the schema, when that changes it.
 */
export async function syncBase(
  vault: Vault,
  path: string,
  schema: DatabaseSchema,
  save: (next: DatabaseSchema) => void,
): Promise<void> {
  const where = basePath(path);
  const written = await writtenBases(vault);
  const file = await vault.readFile(where);
  if (file.binary === true) return;
  const exists = file.missing !== true;
  let next = schema;
  if (exists && written[path] !== file.hash) {
    next = readBase(file.text, schema);
    if (JSON.stringify(next) !== JSON.stringify(schema)) save(next);
  }
  const text = writeBase(next, path, exists ? file.text : undefined);
  const hash =
    exists && text === file.text
      ? file.hash
      : (await vault.writeFile(where, text, exists ? file.hash : "")).hash;
  if (written[path] !== hash) await vault.writeData("bases", { ...written, [path]: hash });
}

/** The vault's databases: the notes whose frontmatter has a schema. */
export function databaseNotes(graph: LinkGraph): GraphNote[] {
  return [...graph.notes()]
    .filter((note) => note.index.properties.some((entry) => entry.key === databaseKey))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The shortest link that finds the note at `path` from the note at `from`, as Obsidian writes one. */
export function shortLink(vault: Vault, path: string, from: string): string {
  return `[[${vault.linkTo(path, from).replace(/\.md$/i, "")}]]`;
}

/** A property's links: a list's, or the one link it holds. */
function linksOf(value: JsonValue | undefined): string[] {
  const items: readonly JsonValue[] = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return items.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/**
 * Keeps the other end of a two-way relation (ADR 0019): each row a row's
 * links now find, and did not, gets a link back to it in `backlink`, and
 * each it no longer finds loses it. Links are matched by the note they
 * find, not by how they are written.
 */
export async function syncBacklinks(
  vault: Vault,
  graph: LinkGraph,
  row: { readonly id: NoteId; readonly path: string },
  before: JsonValue | undefined,
  after: JsonValue,
  backlink: string,
): Promise<void> {
  const resolve = resolveLink(graph, row.path);
  const found = (value: JsonValue | undefined) =>
    new Set(linksOf(value).flatMap((link) => resolve(link) ?? []));
  const was = found(before);
  const now = found(after);
  const change = async (target: NoteId, add: boolean) => {
    const path = graph.note(target)?.path;
    if (path === undefined) return;
    const back = resolveLink(graph, path);
    await updateNoteProperty(vault, target, backlink, (current) => {
      const links = linksOf(current);
      const has = links.some((link) => back(link) === row.id);
      if (add) return has ? undefined : [...links, shortLink(vault, row.path, path)];
      return has ? links.filter((link) => back(link) !== row.id) : undefined;
    });
  };
  for (const target of now) if (!was.has(target)) await change(target, true);
  for (const target of was) if (!now.has(target)) await change(target, false);
}
