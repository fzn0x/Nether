// YAML frontmatter and a note's properties. Reading keeps the YAML document,
// so that writing changes only the keys whose values changed and keeps
// comments, key order and the style of everything else.
import { type JsonValue, type PropertyEntry, isPropertyKey } from "@nether/core";
import { Document, type Node, type Pair, isMap, isScalar, parseDocument } from "yaml";
import { sameJson } from "./source.ts";

export interface FrontmatterProperties {
  readonly properties: readonly PropertyEntry[];
  /** Why the YAML could not be read as properties; it is then kept as written. */
  readonly error?: string;
}

function toJson(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJson);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, item]) => [String(key), toJson(item)]));
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  }
  // A symbol or a function, which YAML does not make.
  return null;
}

function keyOf(pair: Pair): string | undefined {
  const key: unknown = isScalar(pair.key) ? pair.key.value : pair.key;
  return typeof key === "string" || typeof key === "number" ? String(key) : undefined;
}

/**
 * The properties in a frontmatter's YAML, in order. Keys Nether cannot use,
 * such as one that starts with `$`, stay in the file but are not properties.
 */
export function readFrontmatter(yaml: string): FrontmatterProperties {
  const document = parseDocument(yaml);
  const [first] = document.errors;
  if (first !== undefined) return { properties: [], error: first.message };
  const contents = document.contents;
  if (contents === null) return { properties: [] };
  if (!isMap(contents)) {
    return { properties: [], error: "The frontmatter must be a list of keys and values." };
  }
  const properties: PropertyEntry[] = [];
  for (const pair of contents.items) {
    const key = keyOf(pair);
    if (key === undefined || !isPropertyKey(key)) continue;
    const value: unknown = (pair.value as Node | null)?.toJS(document) ?? null;
    properties.push({ key, value: toJson(value) });
  }
  return { properties };
}

/**
 * The YAML for a note's properties, changed from `yaml` (the frontmatter as
 * it was, if any) only where `properties` differ from `before`. Returns
 * undefined when nothing is left to write.
 */
export function writeFrontmatter(
  yaml: string | undefined,
  before: readonly PropertyEntry[],
  properties: readonly PropertyEntry[],
): string | undefined {
  const document = yaml === undefined ? new Document({}) : parseDocument(yaml);
  if (!isMap(document.contents)) document.contents = document.createNode({});
  const map = document.contents;
  if (!isMap(map)) throw new Error("The frontmatter is not a map.");
  const old = new Map(before.map((entry) => [entry.key, entry.value]));
  const pairs = new Map<string, Pair>();
  const kept: Pair[] = [];
  for (const pair of map.items) {
    const key = keyOf(pair);
    if (key !== undefined && old.has(key)) pairs.set(key, pair);
    else kept.push(pair);
  }
  const items: Pair[] = [];
  for (const { key, value } of properties) {
    const pair = pairs.get(key);
    if (pair === undefined) {
      items.push(document.createPair(key, value));
    } else {
      if (!sameJson(old.get(key), value)) pair.value = document.createNode(value);
      items.push(pair);
    }
  }
  map.items = [...items, ...kept];
  if (map.items.length === 0) {
    // Nothing left but comments, if any: those stay, without an empty map after them.
    const comments = [document.commentBefore, document.comment].filter(Boolean).join("\n");
    if (comments === "") return undefined;
    return `${comments
      .split("\n")
      .map((line) => `#${line}`)
      .join("\n")}\n`;
  }
  // Follow the file's layout: lists under a key indented or not, and `[a, b]` without padding.
  const flush = yaml !== undefined && /^[^\s#][^\n]*:[ \t]*\r?\n-[ \t]/m.test(yaml);
  return document.toString({ lineWidth: 0, flowCollectionPadding: false, indentSeq: !flush });
}
