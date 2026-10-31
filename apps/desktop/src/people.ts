// People in properties, and what is assigned to whom (task assignment): a
// person property holds names, as Obsidian and Notion's exports write them,
// or links to a person's note, `[[Ana]]`. Who "me" is, this device's own
// name, says what is assigned to me across every database of the vault,
// read from the link index, and the names used are offered as one types.
import { type JsonValue, type NoteId, type PropertyType } from "@nether/core";
import { type Row, databaseOf } from "@nether/database";
import type { GraphNote, LinkGraph } from "@nether/graph";
import type { NoteEntry } from "@nether/storage";
import { databaseNotes, databaseRows, resolveLink } from "./databases.ts";
import type { PropertyTypes } from "./properties.ts";

const nameKey = "nether.myName";
const listeners = new Set<() => void>();
/** The name kept where storage is closed to the page. */
let memory = "";

/** The name this device's person goes by in person properties, or "" before it is set. */
export function myName(): string {
  try {
    return localStorage.getItem(nameKey)?.trim() ?? "";
  } catch {
    return memory;
  }
}

/** Sets the name, or with "", forgets it; what shows what is assigned to it follows. */
export function setMyName(name: string): void {
  memory = name.trim();
  try {
    if (memory === "") localStorage.removeItem(nameKey);
    else localStorage.setItem(nameKey, memory);
  } catch {
    // Not remembered: the name holds until the app closes.
  }
  for (const listener of listeners) listener();
}

/** Calls `listener` when the name changes; returns a function that stops it. */
export function subscribeMyName(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A person as a value names them: a name, or a link's target, `[[Ana|A.]]` as `Ana`. */
export function personName(value: string): string {
  const link = /^\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(value.trim());
  return (link?.[1] ?? value).trim();
}

/** Whether a value names a person, ignoring case and how it is written. */
export function samePerson(value: string, name: string): boolean {
  const a = personName(value).toLocaleLowerCase();
  const b = personName(name).toLocaleLowerCase();
  return a !== "" && a === b;
}

function listOf(value: JsonValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" && value.trim() !== "" ? [value] : [];
}

/** The keys a person property has: the vault's own types, and each database's. */
export function personKeys(
  graph: LinkGraph,
  types: PropertyTypes,
): {
  readonly vault: ReadonlySet<string>;
  readonly databases: ReadonlyMap<
    string,
    { readonly note: GraphNote; readonly keys: ReadonlySet<string> }
  >;
} {
  const vault = new Set(
    Object.entries(types)
      .filter(([, type]) => type === ("person" satisfies PropertyType))
      .map(([key]) => key),
  );
  const databases = new Map<string, { note: GraphNote; keys: Set<string> }>();
  for (const note of databaseNotes(graph)) {
    let schema;
    try {
      schema = databaseOf(note.index.properties, resolveLink(graph, note.path));
    } catch {
      continue;
    }
    if (schema === undefined) continue;
    const keys = new Set(schema.properties.filter((p) => p.type === "person").map((p) => p.key));
    if (keys.size > 0) databases.set(note.path, { note, keys });
  }
  return { vault, databases };
}

/** Every key a person property has, in the vault's types or any database's. */
export function personKeysOf(graph: LinkGraph, types: PropertyTypes): ReadonlySet<string> {
  const { vault, databases } = personKeys(graph, types);
  return new Set([...vault, ...[...databases.values()].flatMap(({ keys }) => [...keys])]);
}

/** The names person properties hold across the vault, as written, once each, sorted. */
export function peopleNames(graph: LinkGraph, types: PropertyTypes): string[] {
  const { vault, databases } = personKeys(graph, types);
  const keys = new Set([...vault, ...[...databases.values()].flatMap(({ keys }) => [...keys])]);
  const names = new Map<string, string>();
  if (keys.size === 0) return [];
  for (const note of graph.notes()) {
    for (const entry of note.index.properties) {
      if (!keys.has(entry.key)) continue;
      for (const value of listOf(entry.value)) {
        const name = personName(value);
        if (name !== "" && !names.has(name.toLocaleLowerCase()))
          names.set(name.toLocaleLowerCase(), name);
      }
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** A note assigned to someone, with what tells how it stands: its first select and date. */
export interface Assigned {
  readonly id: NoteId;
  readonly title: string;
  readonly status?: string;
  readonly date?: string;
}

/** The notes assigned to a person, by database, and those outside one, under "". */
export interface AssignedGroup {
  /** The database's note, or none for notes outside databases. */
  readonly database?: { readonly id: NoteId; readonly title: string };
  readonly notes: readonly Assigned[];
}

function valueText(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value))
    return value.filter((item) => typeof item === "string").join(", ") || undefined;
  return typeof value === "object" ? undefined : String(value);
}

/**
 * What is assigned to a person: in each database, the rows whose person
 * properties name them, with the row's first select and date; and the
 * notes outside databases whose person properties, of the vault's types,
 * name them. Each group sorted by date, those without last, then by title.
 */
export function assignedTo(
  name: string,
  notes: readonly NoteEntry[],
  graph: LinkGraph,
  types: PropertyTypes,
): AssignedGroup[] {
  if (name.trim() === "") return [];
  const { vault, databases } = personKeys(graph, types);
  const order = (a: Assigned, b: Assigned) =>
    (a.date ?? "\u{10FFFF}").localeCompare(b.date ?? "\u{10FFFF}") ||
    a.title.localeCompare(b.title);
  const names = (row: Row, keys: ReadonlySet<string>) =>
    row.properties.some(
      (entry) =>
        keys.has(entry.key) && listOf(entry.value).some((value) => samePerson(value, name)),
    );
  const groups: AssignedGroup[] = [];
  const inDatabases = new Set<NoteId>();
  for (const { note, keys } of databases.values()) {
    let schema;
    try {
      schema = databaseOf(note.index.properties, resolveLink(graph, note.path));
    } catch {
      continue;
    }
    const select = schema?.properties.find((p) => p.type === "select")?.key;
    const date = schema?.properties.find((p) => p.type === "date")?.key;
    const rows = databaseRows(notes, graph, note.path);
    for (const row of rows) inDatabases.add(row.id);
    const mine = rows
      .filter((row) => names(row, keys))
      .map((row): Assigned => {
        const valueOf = (key: string | undefined) =>
          key === undefined
            ? undefined
            : valueText(row.properties.find((entry) => entry.key === key)?.value);
        const status = valueOf(select);
        const when = valueOf(date);
        return {
          id: row.id,
          title: graph.note(row.id)?.title ?? row.path,
          ...(status === undefined ? {} : { status }),
          ...(when === undefined ? {} : { date: when }),
        };
      })
      .sort(order);
    if (mine.length > 0) {
      groups.push({ database: { id: note.id, title: note.title }, notes: mine });
    }
  }
  if (vault.size > 0) {
    const others = [...graph.notes()]
      .filter((note) => !inDatabases.has(note.id))
      .filter((note) =>
        note.index.properties.some(
          (entry) =>
            vault.has(entry.key) && listOf(entry.value).some((value) => samePerson(value, name)),
        ),
      )
      .map((note): Assigned => ({ id: note.id, title: note.title }))
      .sort(order);
    if (others.length > 0) groups.push({ notes: others });
  }
  return groups;
}
