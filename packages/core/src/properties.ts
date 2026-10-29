// Properties: the typed fields of a note, stored as YAML frontmatter on disk.
// Any note can have properties; a database gives its rows a schema of them.
import { isDate } from "./dates.ts";
import { type NoteId, isUuid, readNoteId } from "./ids.ts";
import { type JsonValue, readJson } from "./json.ts";
import {
  fail,
  readArray,
  readFields,
  readLine,
  readName,
  readOneOf,
  readOptional,
} from "./read.ts";

export const propertyTypes = [
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "checkbox",
  "url",
  "person",
  "relation",
  "file",
] as const;

export type PropertyType = (typeof propertyTypes)[number];

/** The colors a select option can have. */
export const optionColors = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type OptionColor = (typeof optionColors)[number];

export interface SelectOption {
  readonly name: string;
  readonly color?: OptionColor;
}

/** A property in a database's schema. */
export interface PropertyDefinition {
  /** The frontmatter key the value is stored under. */
  readonly key: string;
  readonly type: PropertyType;
  /** The options of a select or multi-select property, in order. */
  readonly options?: readonly SelectOption[];
  /** For a relation: the database its values point to, and, when the relation is two-way, the key of the matching property there. */
  readonly relation?: { readonly database: NoteId; readonly backlink?: string };
}

/** A property of a note: a frontmatter key and its value. */
export interface PropertyEntry {
  readonly key: string;
  readonly value: JsonValue;
}

/**
 * Whether a string can be a property key: one line, at most 256 characters,
 * no spaces at either end, and no leading `$`, which marks the built-in
 * properties views can refer to.
 */
export function isPropertyKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 256 &&
    key.trim() === key &&
    !/[\r\n]/.test(key) &&
    !key.startsWith("$")
  );
}

export function readPropertyKey(value: unknown, path: string): string {
  const key = readLine(value, path);
  if (!isPropertyKey(key)) {
    fail(path, "must be a property key: 1 to 256 characters, trimmed, not starting with $");
  }
  return key;
}

function readSelectOption(value: unknown, path: string): SelectOption {
  const fields = readFields(value, path, ["name"], ["color"]);
  const name = readName(fields.name, `${path}.name`);
  const color = readOptional(fields, "color", path, (item, itemPath) =>
    readOneOf(item, itemPath, optionColors),
  );
  return color === undefined ? { name } : { name, color };
}

export function readPropertyDefinition(value: unknown, path: string): PropertyDefinition {
  const fields = readFields(value, path, ["key", "type"], ["options", "relation"]);
  const key = readPropertyKey(fields.key, `${path}.key`);
  const type = readOneOf(fields.type, `${path}.type`, propertyTypes);
  const definition: PropertyDefinition = { key, type };

  if (type === "select" || type === "multiSelect") {
    const options = readArray(fields.options ?? [], `${path}.options`).map((item, index) =>
      readSelectOption(item, `${path}.options[${String(index)}]`),
    );
    const names = new Set<string>();
    options.forEach((option, index) => {
      if (names.has(option.name)) {
        fail(`${path}.options[${String(index)}].name`, `repeats the option "${option.name}"`);
      }
      names.add(option.name);
    });
    if (fields.relation !== undefined) fail(`${path}.relation`, "is only for relation properties");
    return { ...definition, options };
  }
  if (fields.options !== undefined) fail(`${path}.options`, "is only for select properties");

  if (type === "relation") {
    if (fields.relation === undefined) fail(`${path}.relation`, "is missing");
    const relation = readFields(fields.relation, `${path}.relation`, ["database"], ["backlink"]);
    const database = readNoteId(relation.database, `${path}.relation.database`);
    const backlink = readOptional(relation, "backlink", `${path}.relation`, readPropertyKey);
    return {
      ...definition,
      relation: backlink === undefined ? { database } : { database, backlink },
    };
  }
  if (fields.relation !== undefined) fail(`${path}.relation`, "is only for relation properties");
  return definition;
}

/** Reads a note's properties, in order; keys must be unique. */
export function readPropertyEntries(value: unknown, path: string): PropertyEntry[] {
  const keys = new Set<string>();
  return readArray(value, path).map((item, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const fields = readFields(item, itemPath, ["key"], ["value"]);
    const key = readPropertyKey(fields.key, `${itemPath}.key`);
    if (keys.has(key)) fail(`${itemPath}.key`, `repeats the property "${key}"`);
    keys.add(key);
    // A key with no value, as `status:` in YAML, holds null.
    return { key, value: readJson(fields.value ?? null, `${itemPath}.value`) };
  });
}

function isStringList(value: JsonValue, check: (item: string) => boolean): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && check(item));
}

const urlPattern = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;
const nonEmpty = (item: string): boolean => item.trim() !== "";

/**
 * Checks that a value fits a property type, and throws a ModelError when it
 * does not. Every type can be empty, which is null.
 */
export function checkPropertyValue(type: PropertyType, value: JsonValue, path: string): void {
  if (value === null) return;
  const fits = ((): boolean => {
    switch (type) {
      case "text":
      case "select":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "multiSelect":
        return isStringList(value, nonEmpty);
      case "date":
        return typeof value === "string" && isDate(value);
      case "checkbox":
        return typeof value === "boolean";
      case "url":
        return typeof value === "string" && urlPattern.test(value);
      case "person":
      case "file":
        return isStringList(value, nonEmpty);
      case "relation":
        return isStringList(value, isUuid);
    }
  })();
  if (!fits) fail(path, `does not fit a ${type} property`);
}
