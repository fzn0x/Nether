// Notes and their JSON form. Everything in Nether is a note: a page, a
// database (a note with a schema), or a database's row (a note under it).
import { type ContentBlock, readContent } from "./blocks.ts";
import { type DatabaseSchema, readDatabaseSchema } from "./databases.ts";
import { isTimestamp, now } from "./dates.ts";
import { ModelError } from "./errors.ts";
import { type NoteId, newNoteId, readNoteId } from "./ids.ts";
import { type PropertyEntry, readPropertyEntries } from "./properties.ts";
import {
  fail,
  readFields,
  readInteger,
  readLine,
  readOneOf,
  readOptional,
  readString,
} from "./read.ts";

export interface Note {
  readonly id: NoteId;
  /** The note's name, its file name on the desktop. May be empty: the app shows "Untitled". */
  readonly title: string;
  /** Its properties, the frontmatter on disk, in order. */
  readonly properties: readonly PropertyEntry[];
  readonly content: readonly ContentBlock[];
  /** The note it is nested under in the page tree; for a row, its database. */
  readonly parent?: NoteId;
  /** Present when the note is a database. */
  readonly database?: DatabaseSchema;
  readonly created: string;
  readonly updated: string;
  /** When the note went to the trash. */
  readonly trashed?: string;
}

/** The version of the JSON form this code writes, and the newest it reads. */
export const formatVersion = 1;

export function readTimestamp(value: unknown, path: string): string {
  const text = readString(value, path);
  if (!isTimestamp(text)) fail(path, "must be a UTC timestamp such as 2026-10-30T08:00:00.000Z");
  return text;
}

/** Checks a value against the note model and returns a copy with its fields in a fixed order. */
export function noteFromJson(value: unknown, path = "note"): Note {
  const fields = readFields(
    value,
    path,
    ["id", "title", "properties", "content", "created", "updated"],
    ["parent", "database", "trashed"],
  );
  const id = readNoteId(fields.id, `${path}.id`);
  const parent = readOptional(fields, "parent", path, readNoteId);
  if (parent === id) fail(`${path}.parent`, "must not be the note itself");
  const database = readOptional(fields, "database", path, readDatabaseSchema);
  const trashed = readOptional(fields, "trashed", path, readTimestamp);
  return {
    id,
    title: readLine(fields.title, `${path}.title`),
    properties: readPropertyEntries(fields.properties, `${path}.properties`),
    content: readContent(fields.content, `${path}.content`),
    ...(parent === undefined ? {} : { parent }),
    ...(database === undefined ? {} : { database }),
    created: readTimestamp(fields.created, `${path}.created`),
    updated: readTimestamp(fields.updated, `${path}.updated`),
    ...(trashed === undefined ? {} : { trashed }),
  };
}

/** Reads the envelope `{ format, version, <key> }` that every JSON file of Nether's has. */
export function readEnvelope(text: string, format: string, key: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ModelError("$", `is not JSON: ${(error as Error).message}`);
  }
  const fields = readFields(value, "$", ["format", "version", key]);
  readOneOf(fields.format, "$.format", [format]);
  const version = readInteger(fields.version, "$.version", 1, Number.MAX_SAFE_INTEGER);
  if (version > formatVersion) {
    fail(
      "$.version",
      `is ${String(version)}, newer than this version of Nether reads (${String(formatVersion)})`,
    );
  }
  return fields[key];
}

/** Writes a note as JSON, after checking it. The output is the same for equal notes. */
export function serializeNote(note: Note): string {
  return `${JSON.stringify({ format: "nether.note", version: formatVersion, note: noteFromJson(note) }, null, 2)}\n`;
}

/** Reads a note from the JSON that serializeNote writes. Throws a ModelError naming what is wrong. */
export function parseNote(text: string): Note {
  return noteFromJson(readEnvelope(text, "nether.note", "note"));
}

export interface NewNote {
  readonly title: string;
  readonly properties?: readonly PropertyEntry[];
  readonly content?: readonly ContentBlock[];
  readonly parent?: NoteId;
  readonly database?: DatabaseSchema;
}

/** Creates a note with a new ID, created and updated now. */
export function createNote(init: NewNote, at: string = now()): Note {
  return noteFromJson({
    id: newNoteId(),
    title: init.title,
    properties: init.properties ?? [],
    content: init.content ?? [],
    ...(init.parent === undefined ? {} : { parent: init.parent }),
    ...(init.database === undefined ? {} : { database: init.database }),
    created: at,
    updated: at,
  });
}
