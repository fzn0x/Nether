// Query blocks (ADR 0021): a `base` code block in a note, as Obsidian
// embeds a base, whose filters find notes anywhere in the vault by folder,
// tag or property, and whose views show them. Its filters and formulas are
// expressions of the formula language (ADR 0020), with Obsidian's `file.`
// functions; a block only shows notes, and writes nothing anywhere.
import type { JsonValue, NoteId } from "@nether/core";
import { parse } from "yaml";
import {
  type FormulaContext,
  FormulaError,
  type FormulaNode,
  type FormulaValue,
  evaluateFormula,
  fileOf,
  formulaJson,
  formulaText,
  formulaWork,
  order,
  parseFormula,
  readFormulas,
  readValue,
  truthy,
} from "./formula.ts";
import type { Group } from "./query.ts";
import { type Row, rowTitle, rowValue } from "./rows.ts";

/** A query's filter: an expression, or all, any or none of other filters. */
export type QueryFilter =
  | { readonly expression: FormulaNode }
  | { readonly and: readonly QueryFilter[] }
  | { readonly or: readonly QueryFilter[] }
  | { readonly not: readonly QueryFilter[] };

/** A sort, or a grouping: a property, as `note.status`, `file.mtime` or `formula.total`, and a direction. */
export interface QuerySort {
  readonly property: string;
  readonly direction: "ASC" | "DESC";
}

/** A view of a query block, as a base writes one. */
export interface QueryView {
  readonly name: string;
  /** Obsidian's type of view: `table`, `list` or `cards`; another shows as a table. */
  readonly type: string;
  readonly filter?: QueryFilter;
  /** The properties it shows, in order, besides each note's name. */
  readonly order: readonly string[];
  readonly sort: readonly QuerySort[];
  readonly groupBy?: QuerySort;
  /** How many notes it shows at most. */
  readonly limit?: number;
  /** The property a card's image is named by. */
  readonly image?: string;
}

/** A query block, read from the base its code holds. */
export interface Query {
  readonly filter?: QueryFilter;
  readonly formulas: ReadonlyMap<string, FormulaNode | FormulaError>;
  /** What the base calls a property, by the property. */
  readonly names: ReadonlyMap<string, string>;
  /** At least one: a table of the notes' names when the base has none. */
  readonly views: readonly QueryView[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFilter(value: unknown, where: string): QueryFilter {
  if (typeof value === "string") {
    try {
      return { expression: parseFormula(value) };
    } catch (error) {
      throw new FormulaError(`${where}: ${messageOf(error)}`);
    }
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const [join] = keys;
    const parts = join === undefined ? undefined : value[join];
    if (keys.length === 1 && Array.isArray(parts)) {
      const read = parts.map((part: unknown) => readFilter(part, where));
      if (join === "and") return { and: read };
      if (join === "or") return { or: read };
      if (join === "not") return { not: read };
    }
  }
  throw new FormulaError(
    `${where}: a filter is an expression, or "and", "or" or "not" with a list of filters`,
  );
}

function readSort(value: unknown, where: string): QuerySort {
  if (isRecord(value) && typeof value.property === "string" && value.property.trim() !== "") {
    const direction =
      typeof value.direction === "string" && value.direction.toUpperCase() === "DESC"
        ? "DESC"
        : "ASC";
    return { property: value.property.trim(), direction };
  }
  throw new FormulaError(`${where}: a sort names a property, and a direction, ASC or DESC`);
}

function readView(value: unknown, index: number): QueryView {
  const where = `View ${String(index + 1)}`;
  if (!isRecord(value)) throw new FormulaError(`${where} is not a list of its settings`);
  const type = typeof value.type === "string" && value.type.trim() !== "" ? value.type : "table";
  const name =
    typeof value.name === "string" && value.name.trim() !== ""
      ? value.name
      : `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  const named = `The view "${name}"`;
  const order = Array.isArray(value.order)
    ? value.order.filter((entry: unknown): entry is string => typeof entry === "string")
    : [];
  const sort = Array.isArray(value.sort)
    ? value.sort.map((entry: unknown) => readSort(entry, `${named}'s sort`))
    : [];
  const limit = value.limit;
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1)
  ) {
    throw new FormulaError(`${named}'s limit is not a number of notes`);
  }
  return {
    name,
    type,
    order: order.map((entry) => entry.trim()),
    sort,
    ...(value.filters === undefined || value.filters === null
      ? {}
      : { filter: readFilter(value.filters, `${named}'s filters`) }),
    ...(value.groupBy === undefined || value.groupBy === null
      ? {}
      : { groupBy: readSort(value.groupBy, `${named}'s groupBy`) }),
    ...(typeof limit === "number" ? { limit } : {}),
    ...(typeof value.image === "string" && value.image.trim() !== ""
      ? { image: value.image.trim() }
      : {}),
  };
}

/**
 * A query block read from its code, a base's YAML: its filters, formulas,
 * property names and views. What cannot be read throws a FormulaError that
 * says why; a formula that cannot be read is an error in its cells only.
 */
export function readQuery(source: string): Query {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    // The first line says what and where; the rest shows the text again.
    throw new FormulaError(`The query cannot be read: ${messageOf(error).split("\n")[0] ?? ""}`);
  }
  value ??= {};
  if (!isRecord(value)) throw new FormulaError("The query is not a base: a list of its settings");
  const formulas = isRecord(value.formulas) ? value.formulas : {};
  const entries = Object.entries(formulas).map(([key, text]) => {
    if (typeof text !== "string" && typeof text !== "number" && typeof text !== "boolean")
      throw new FormulaError(`The formula ${key} is not an expression`);
    return [key, String(text)] as const;
  });
  const names = new Map<string, string>();
  if (isRecord(value.properties)) {
    for (const [property, settings] of Object.entries(value.properties)) {
      if (isRecord(settings) && typeof settings.displayName === "string")
        names.set(property, settings.displayName);
    }
  }
  const views = Array.isArray(value.views) ? value.views.map(readView) : [];
  return {
    ...(value.filters === undefined || value.filters === null
      ? {}
      : { filter: readFilter(value.filters, "The filters") }),
    formulas: readFormulas(entries),
    names,
    views:
      views.length > 0 ? views : [{ name: "Table", type: "table", order: ["file.name"], sort: [] }],
  };
}

/** A column of a view: the property it reads, and what it is called. */
export interface QueryColumn {
  readonly property: string;
  readonly label: string;
}

/** What a view of a query shows. */
export interface QueryResult {
  readonly columns: readonly QueryColumn[];
  /** The notes found, in order, each with its columns' values under their labels. */
  readonly rows: readonly Row[];
  /** The notes by the value of the property the view groups by, when it groups. */
  readonly groups?: readonly Group[];
  /** How many notes the filters found, before the view's limit. */
  readonly total: number;
  /** What a card's image names, as written, for each note that has one. */
  readonly images: ReadonlyMap<NoteId, string>;
  /** Why a filter could not be worked out for a note, the first time one could not. */
  readonly error?: string;
}

/** The name of a note, the title column every view shows first. */
const titles = new Set(["file.name", "file.basename"]);

/** A property as a base names it: `note.status` is `status`'s own. */
function keyOf(property: string): string {
  return property.startsWith("note.") ? property.slice("note.".length) : property;
}

function isEmpty(value: FormulaValue): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(a: FormulaValue, b: FormulaValue): number {
  return order(a, b) ?? collator.compare(formulaText(a), formulaText(b));
}

/** Works out a view of a query over the vault's notes, at a moment, for `today()`. */
export function runQuery(
  query: Query,
  view: QueryView,
  notes: readonly Row[],
  now = new Date(),
): QueryResult {
  let error: string | undefined;
  // `file.` properties are expressions, read once for every note.
  const parsed = new Map<string, FormulaNode>();
  const fileNode = (property: string): FormulaNode => {
    const known = parsed.get(property);
    if (known !== undefined) return known;
    const node = parseFormula(property);
    parsed.set(property, node);
    return node;
  };
  const found: { note: Row; read: (property: string) => FormulaValue }[] = [];
  const filters = [query.filter, view.filter].filter(
    (filter): filter is QueryFilter => filter !== undefined,
  );
  for (const note of notes) {
    const { work, context } = formulaWork(query.formulas, (formula) => ({
      // Without the vault's types, text that is a date reads as one, as Obsidian takes a new property's type.
      property: (key) => readValue(rowValue(note, key), { key, type: "date" }, key),
      formula,
      file: fileOf(note),
      now,
    }));
    const read = (property: string): FormulaValue => {
      if (property.startsWith("formula.")) return work(property.slice("formula.".length));
      if (property.startsWith("file.")) return evaluateFormula(fileNode(property), context);
      return context.property(keyOf(property));
    };
    try {
      if (filters.every((filter) => passes(filter, context))) found.push({ note, read });
    } catch (failure) {
      error ??= `${rowTitle(note)}: ${messageOf(failure)}`;
    }
  }

  const valueOf = (item: (typeof found)[number], property: string): FormulaValue => {
    try {
      return item.read(property);
    } catch {
      return null;
    }
  };
  // Each note's values to sort by, worked out once rather than at each comparison.
  const keyed = found.map((item) => ({
    item,
    title: rowTitle(item.note),
    keys: view.sort.map((sort) => valueOf(item, sort.property)),
  }));
  keyed.sort((a, b) => {
    for (const [index, sort] of view.sort.entries()) {
      const left = a.keys[index] ?? null;
      const right = b.keys[index] ?? null;
      // Notes without a value go last whichever way the sort goes.
      if (isEmpty(left) !== isEmpty(right)) return isEmpty(left) ? 1 : -1;
      const compared = compare(left, right);
      if (compared !== 0) return sort.direction === "ASC" ? compared : -compared;
    }
    return collator.compare(a.title, b.title);
  });
  const sorted = keyed.map(({ item }) => item);
  const shown = view.limit === undefined ? sorted : sorted.slice(0, view.limit);

  const columns = columnsOf(view, query.names);
  const images = new Map<NoteId, string>();
  const made = shown.map((item) => {
    const errors = new Map<string, string>();
    const properties = columns.map((column) => {
      try {
        return { key: column.label, value: formulaJson(item.read(column.property)) };
      } catch (failure) {
        errors.set(column.label, messageOf(failure));
        return { key: column.label, value: null };
      }
    });
    if (view.image !== undefined) {
      const image = formulaJson(valueOf(item, view.image));
      const items: readonly JsonValue[] = Array.isArray(image) ? image : [image];
      const first = items[0];
      if (typeof first === "string" && first.trim() !== "") images.set(item.note.id, first);
    }
    const row: Row = {
      id: item.note.id,
      path: item.note.path,
      updated: item.note.updated,
      properties,
      ...(errors.size === 0 ? {} : { errors }),
    };
    return { item, row };
  });
  const rows = made.map(({ row }) => row);

  const groupBy = view.groupBy;
  return {
    columns,
    rows,
    ...(groupBy === undefined
      ? {}
      : {
          groups: groupsOf(
            made.map(({ item, row }) => ({ row, value: valueOf(item, groupBy.property) })),
            groupBy.direction,
          ),
        }),
    total: found.length,
    images,
    ...(error === undefined ? {} : { error }),
  };
}

function passes(filter: QueryFilter, context: FormulaContext): boolean {
  if ("expression" in filter) return truthy(evaluateFormula(filter.expression, context));
  if ("and" in filter) return filter.and.every((part) => passes(part, context));
  if ("or" in filter) return filter.or.some((part) => passes(part, context));
  return !filter.not.some((part) => passes(part, context));
}

/** The columns a view shows besides the notes' names, each called by its own name, once. */
function columnsOf(view: QueryView, names: ReadonlyMap<string, string>): QueryColumn[] {
  const columns: QueryColumn[] = [];
  const read = new Set<string>();
  for (const property of view.order) {
    // `note.status` and `status` are one column.
    const key = property.startsWith("note.") ? keyOf(property) : property;
    if (titles.has(property) || read.has(key)) continue;
    read.add(key);
    const short = property.startsWith("formula.")
      ? property.slice("formula.".length)
      : keyOf(property);
    const named = names.get(property) ?? names.get(short) ?? short;
    // Two columns that would be called alike are called by what they read.
    const label = columns.some((column) => column.label === named) ? property : named;
    columns.push({ property, label });
  }
  return columns;
}

/** Notes by a value, the groups in its order, and notes without one last. */
function groupsOf(
  items: readonly { readonly row: Row; readonly value: FormulaValue }[],
  direction: "ASC" | "DESC",
): Group[] {
  const groups = new Map<string, { value: FormulaValue; rows: Row[] }>();
  const none: Row[] = [];
  for (const { row, value } of items) {
    if (isEmpty(value)) {
      none.push(row);
      continue;
    }
    const id = JSON.stringify(formulaJson(value));
    const group = groups.get(id);
    if (group === undefined) groups.set(id, { value, rows: [row] });
    else group.rows.push(row);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    direction === "ASC" ? compare(a.value, b.value) : compare(b.value, a.value),
  );
  return [
    ...ordered.map((group): Group => ({ value: formulaJson(group.value), rows: group.rows })),
    ...(none.length === 0 ? [] : [{ value: null, rows: none }]),
  ];
}
