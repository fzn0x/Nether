// The Obsidian base beside a database (ADR 0018): written from its schema,
// keeping every key Nether does not own, and read back when Obsidian
// changes it. Nether owns the base's `filters`, which find the database's
// rows, and each view's `type`, `name`, `order`, `groupBy` and `filters`;
// a view of a type it has no layout for, such as a map, is Obsidian's.
import {
  type Condition,
  type DatabaseSchema,
  type Filter,
  type FilterOperator,
  type JsonValue,
  type View,
  type ViewLayout,
  readDatabaseSchema,
} from "@nether/core";
import { Document, YAMLMap, YAMLSeq, isMap, isSeq, parse, parseDocument } from "yaml";
import { rowFolder } from "./rows.ts";
import { viewIdOf } from "./schema.ts";

/** Where a database's base is: beside its note, with its name. */
export function basePath(databasePath: string): string {
  return `${rowFolder(databasePath)}.base`;
}

const typeOf: Record<ViewLayout, string> = {
  table: "table",
  board: "kanban",
  gallery: "cards",
  list: "list",
  // Obsidian has no calendar or timeline: a table of their dates.
  calendar: "table",
  timeline: "table",
};

/** The layout of a base's view, keeping a calendar or timeline Obsidian shows as a table. */
function layoutOf(type: unknown, current: View | undefined): ViewLayout | undefined {
  switch (type) {
    case "table":
      return current?.layout === "calendar" || current?.layout === "timeline"
        ? current.layout
        : "table";
    case "kanban":
      return "board";
    case "cards":
      return "gallery";
    case "list":
      return "list";
    default:
      return undefined;
  }
}

const builtIn: Record<string, string> = {
  $title: "file.basename",
  $created: "file.ctime",
  $updated: "file.mtime",
};

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A property as Obsidian's expressions name it. */
function reference(key: string): string {
  return builtIn[key] ?? (identifier.test(key) ? key : `note[${JSON.stringify(key)}]`);
}

/** A property as a view's `order` and `groupBy` name it. */
function column(key: string): string {
  return builtIn[key] ?? key;
}

/** The property an expression or a column names, if Nether knows it. */
function keyOf(reference: string): string | undefined {
  const named = Object.entries(builtIn).find(([, written]) => written === reference)?.[0];
  if (named !== undefined) return named;
  if (reference.startsWith("note[")) {
    try {
      const key: unknown = JSON.parse(reference.slice(5, -1));
      return typeof key === "string" ? key : undefined;
    } catch {
      return undefined;
    }
  }
  return reference.replace(/^note\./, "");
}

function isDateKey(schema: DatabaseSchema, key: string): boolean {
  return (
    key === "$created" ||
    key === "$updated" ||
    schema.properties.find((property) => property.key === key)?.type === "date"
  );
}

function literal(value: JsonValue | undefined, date: boolean): string {
  if (date && typeof value === "string") return `date(${JSON.stringify(value.slice(0, 10))})`;
  // JSON's strings, numbers and booleans are written as Obsidian's expressions write them.
  return JSON.stringify(value ?? null);
}

const comparisons: Partial<Record<FilterOperator, string>> = {
  equals: "==",
  notEquals: "!=",
  greaterThan: ">",
  greaterOrEqual: ">=",
  lessThan: "<",
  lessOrEqual: "<=",
  before: "<",
  after: ">",
  onOrBefore: "<=",
  onOrAfter: ">=",
};

/** A condition as an Obsidian expression. */
function expression(condition: Condition, schema: DatabaseSchema): string {
  const target = reference(condition.property);
  const value = literal(condition.value, isDateKey(schema, condition.property));
  switch (condition.operator) {
    case "contains":
    case "startsWith":
    case "endsWith":
      return `${target}.${condition.operator}(${value})`;
    case "notContains":
      return `!${target}.contains(${value})`;
    case "isEmpty":
      return `${target}.isEmpty()`;
    case "isNotEmpty":
      return `!${target}.isEmpty()`;
    default:
      return `${target} ${comparisons[condition.operator] ?? "=="} ${value}`;
  }
}

function filterValue(filter: Filter, schema: DatabaseSchema): JsonValue {
  if ("and" in filter) return { and: filter.and.map((part) => filterValue(part, schema)) };
  if ("or" in filter) return { or: filter.or.map((part) => filterValue(part, schema)) };
  return expression(filter, schema);
}

const referencePattern = String.raw`file\.basename|file\.ctime|file\.mtime|note\[(?:"(?:[^"\\]|\\.)*")\]|(?:note\.)?[A-Za-z_][A-Za-z0-9_]*`;
const literalPattern = String.raw`"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|date\("\d{4}-\d{2}-\d{2}"\)`;
const methodCall = new RegExp(
  `^(!?)(${referencePattern})\\.(contains|startsWith|endsWith)\\((${literalPattern})\\)$`,
);
const emptyCall = new RegExp(`^(!?)(${referencePattern})\\.isEmpty\\(\\)$`);
const comparison = new RegExp(`^(${referencePattern}) (==|!=|>=|<=|>|<) (${literalPattern})$`);

function readLiteral(text: string): JsonValue {
  const date = /^date\("(\d{4}-\d{2}-\d{2})"\)$/.exec(text);
  return date?.[1] ?? (JSON.parse(text) as JsonValue);
}

function knows(schema: DatabaseSchema, key: string): boolean {
  return key in builtIn || schema.properties.some((property) => property.key === key);
}

/** A condition read from an Obsidian expression, if it is one Nether writes. */
function readExpression(text: string, schema: DatabaseSchema): Condition | undefined {
  const trimmed = text.trim();
  const method = methodCall.exec(trimmed);
  if (method !== null) {
    const [, not = "", target = "", call = "", value = ""] = method;
    const property = keyOf(target);
    if (property === undefined || !knows(schema, property)) return undefined;
    if (not !== "" && call !== "contains") return undefined;
    const operator: FilterOperator = not === "" ? (call as FilterOperator) : "notContains";
    return { property, operator, value: readLiteral(value) };
  }
  const empty = emptyCall.exec(trimmed);
  if (empty !== null) {
    const property = keyOf(empty[2] ?? "");
    if (property === undefined || !knows(schema, property)) return undefined;
    return { property, operator: empty[1] === "!" ? "isNotEmpty" : "isEmpty" };
  }
  const compared = comparison.exec(trimmed);
  if (compared === null) return undefined;
  const [, target = "", sign = "", value = ""] = compared;
  const property = keyOf(target);
  if (property === undefined || !knows(schema, property)) return undefined;
  const date = isDateKey(schema, property);
  const operator = (Object.entries(comparisons) as [FilterOperator, string][]).find(
    ([name, written]) =>
      written === sign &&
      (date
        ? ["equals", "notEquals", "before", "after", "onOrBefore", "onOrAfter"].includes(name)
        : !["before", "after", "onOrBefore", "onOrAfter"].includes(name)),
  )?.[0];
  return operator === undefined ? undefined : { property, operator, value: readLiteral(value) };
}

/** A filter read from a base, or undefined when part of it is Obsidian's alone. */
function readFilter(value: unknown, schema: DatabaseSchema): Filter | undefined {
  if (typeof value === "string") return readExpression(value, schema);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const join = "and" in value ? "and" : "or" in value ? "or" : undefined;
  const parts: unknown = join === undefined ? undefined : (value as Record<string, unknown>)[join];
  if (join === undefined || !Array.isArray(parts) || Object.keys(value).length !== 1)
    return undefined;
  const read = parts.map((part: unknown) => readFilter(part, schema));
  if (read.length === 0 || read.some((part) => part === undefined)) return undefined;
  const filters = read as Filter[];
  return join === "and" ? { and: filters } : { or: filters };
}

/** The keys of a schema's rollups and formulas, which only Nether works out. */
function rollupKeys(schema: DatabaseSchema): Set<string> {
  return new Set(
    schema.properties
      .filter((property) => property.rollup !== undefined || property.formula !== undefined)
      .map((property) => property.key),
  );
}

/** Whether a filter names a rollup, which the base cannot. */
function namesRollup(filter: Filter | undefined, rollups: ReadonlySet<string>): boolean {
  if (filter === undefined) return false;
  if ("and" in filter) return filter.and.some((part) => namesRollup(part, rollups));
  if ("or" in filter) return filter.or.some((part) => namesRollup(part, rollups));
  return rollups.has(filter.property);
}

/** What Nether writes of a view: its owned keys, the others Obsidian's. */
function viewValue(view: View, schema: DatabaseSchema): Record<string, JsonValue> {
  const rollups = rollupKeys(schema);
  return {
    type: typeOf[view.layout],
    name: view.name,
    order: ["file.name", ...view.visible.filter((key) => !rollups.has(key)).map(column)],
    ...(view.groupBy === undefined
      ? {}
      : { groupBy: { property: column(view.groupBy), direction: "ASC" } }),
    ...(view.filter === undefined || namesRollup(view.filter, rollups)
      ? {}
      : { filters: filterValue(view.filter, schema) }),
  };
}

const owned = ["type", "name", "order", "groupBy", "filters"];

/**
 * A database's base, made from its schema. Given the base as it is, it
 * keeps every key Nether does not own, and every view it has no layout for.
 */
export function writeBase(schema: DatabaseSchema, databasePath: string, previous?: string): string {
  const parsed = previous === undefined ? undefined : parseDocument(previous);
  // A base Obsidian cannot read either is written anew.
  const document: Document =
    parsed?.errors.length === 0 && isMap(parsed.contents) ? parsed : new Document({});
  document.set(
    "filters",
    document.createNode({
      and: [`file.folder == ${JSON.stringify(rowFolder(databasePath))}`, 'file.ext == "md"'],
    }),
  );
  const before = document.get("views");
  const existing = isSeq(before) ? before.items.filter(isMap) : [];
  const byName = new Map<string, YAMLMap>();
  const foreign: YAMLMap[] = [];
  for (const item of existing) {
    const name = item.get("name");
    if (typeof name === "string" && layoutOf(item.get("type"), undefined) !== undefined) {
      byName.set(name, item);
    } else {
      foreign.push(item);
    }
  }
  const views = new YAMLSeq();
  for (const view of schema.views) {
    const value = viewValue(view, schema);
    const item = byName.get(view.name);
    if (item === undefined) {
      views.add(document.createNode(value));
      continue;
    }
    // A filter with Obsidian's own functions stays Obsidian's, as readBase leaves it.
    const filters: unknown = item.get("filters");
    const theirs =
      filters !== undefined &&
      readFilter(isMap(filters) || isSeq(filters) ? filters.toJSON() : filters, schema) ===
        undefined;
    for (const key of owned) {
      if (key === "filters" && theirs) continue;
      if (key in value) item.set(key, document.createNode(value[key]));
      else item.delete(key);
    }
    views.add(item);
  }
  for (const item of foreign) views.add(item);
  document.set("views", views);
  return document.toString({ lineWidth: 0 });
}

/**
 * A database's schema with what an edit of its base in Obsidian changed: a
 * view's columns, grouping and filters by its name, views added and
 * removed. What it cannot read, it leaves as the schema had it.
 */
export function readBase(text: string, schema: DatabaseSchema): DatabaseSchema {
  let value: unknown;
  try {
    value = parse(text);
  } catch {
    return schema;
  }
  if (typeof value !== "object" || value === null) return schema;
  const listed: unknown = (value as { views?: unknown }).views;
  if (!Array.isArray(listed)) return schema;
  const keys = new Set(schema.properties.map((property) => property.key));
  const rollups = rollupKeys(schema);
  const views: View[] = [];
  for (const item of listed) {
    if (typeof item !== "object" || item === null) continue;
    const base = item as Record<string, unknown>;
    if (typeof base.name !== "string" || views.some((view) => view.name === base.name)) continue;
    const current = schema.views.find((view) => view.name === base.name);
    const layout = layoutOf(base.type, current);
    if (layout === undefined) continue;
    const visible = Array.isArray(base.order)
      ? [
          ...base.order
            .map((entry: unknown) => (typeof entry === "string" ? keyOf(entry) : undefined))
            .filter(
              (key): key is string => key !== undefined && keys.has(key) && !rollups.has(key),
            ),
          // The rollup columns the base could not hold stay.
          ...(current?.visible ?? []).filter((key) => rollups.has(key)),
        ]
      : (current?.visible ?? []);
    const grouped =
      typeof base.groupBy === "object" && base.groupBy !== null
        ? (base.groupBy as { property?: unknown }).property
        : undefined;
    const groupBy = typeof grouped === "string" ? keyOf(grouped) : undefined;
    // A filter of a rollup was left out of the base: the view keeps it.
    const filter =
      base.filters === undefined
        ? namesRollup(current?.filter, rollups)
          ? current?.filter
          : undefined
        : (readFilter(base.filters, schema) ?? current?.filter);
    const sorts = current?.sorts;
    const date = current?.date;
    const end = current?.end;
    const cover = current?.cover;
    const view: View = {
      id: viewIdOf(base.name),
      name: base.name,
      layout,
      visible: [...new Set(visible)],
      ...(filter === undefined ? {} : { filter }),
      ...(sorts === undefined ? {} : { sorts }),
      ...(groupBy === undefined || !keys.has(groupBy) ? {} : { groupBy }),
      ...(date === undefined ? {} : { date }),
      ...(end === undefined ? {} : { end }),
      ...(cover === undefined ? {} : { cover }),
    };
    // A view the schema cannot hold, as a board without a property to group by, stays as it was.
    try {
      readDatabaseSchema({ properties: schema.properties, views: [view] }, "view");
      views.push(view);
    } catch {
      if (current !== undefined) views.push(current);
    }
  }
  return { properties: schema.properties, views };
}
