// A view's rows: those its filter keeps, in its sorts' order, grouped by
// its property when it has one, as a board's columns are.
import type {
  Condition,
  DatabaseSchema,
  Filter,
  JsonValue,
  PropertyType,
  Sort,
  View,
} from "@nether/core";
import { type Row, linkName, rowTitle, rowValue } from "./rows.ts";

/** Sorts as a file explorer does: case aside, and numbers by their value. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** What a property's values are compared as. */
type Kind = PropertyType | "timestamp";

function kindOf(schema: DatabaseSchema, key: string): Kind | undefined {
  if (key === "$title") return "text";
  if (key === "$created" || key === "$updated") return "timestamp";
  return schema.properties.find((property) => property.key === key)?.type;
}

function isEmpty(value: JsonValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A value's items: a list's, or the value alone. */
function itemsOf(value: JsonValue | undefined): readonly JsonValue[] {
  if (value === undefined || value === null) return [];
  const items: readonly JsonValue[] = Array.isArray(value) ? value : [value];
  return items;
}

/** The day of a date or of a timestamp, as `YYYY-MM-DD` in local time. */
function dayOf(value: JsonValue | undefined): string | undefined {
  if (typeof value === "number") {
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : undefined;
}

// A link, as a relation's value, compares as the name of the note it names.
function sameText(a: JsonValue, b: JsonValue): boolean {
  if (typeof a === "string" && typeof b === "string") {
    return collator.compare(linkName(a), linkName(b)) === 0;
  }
  return a === b;
}

function textOf(value: JsonValue): string {
  return typeof value === "string"
    ? linkName(value).toLowerCase()
    : JSON.stringify(value).toLowerCase();
}

function compareOrder(
  value: JsonValue | undefined,
  wanted: JsonValue | undefined,
  kind: Kind | undefined,
): number | undefined {
  if (kind === "date" || kind === "timestamp") {
    const day = dayOf(value);
    const other = dayOf(wanted);
    return day === undefined || other === undefined ? undefined : day.localeCompare(other);
  }
  if (typeof value === "number" && typeof wanted === "number") return value - wanted;
  if (typeof value === "string" && typeof wanted === "string")
    return collator.compare(value, wanted);
  return undefined;
}

/** A row's day by a date property or its file's times, as `YYYY-MM-DD`, where it has one. */
export function rowDate(row: Row, key: string): string | undefined {
  return dayOf(rowValue(row, key));
}

/** Whether a row meets one condition of a filter. */
function meets(row: Row, condition: Condition, schema: DatabaseSchema): boolean {
  const value = rowValue(row, condition.property);
  const kind = kindOf(schema, condition.property);
  const wanted = condition.value;
  const items = itemsOf(value);
  const is = (test: (item: JsonValue) => boolean) => items.some(test);
  switch (condition.operator) {
    case "isEmpty":
      return isEmpty(value);
    case "isNotEmpty":
      return !isEmpty(value);
    case "equals":
      if (kind === "date" || kind === "timestamp") return compareOrder(value, wanted, kind) === 0;
      return wanted !== undefined && is((item) => sameText(item, wanted));
    case "notEquals":
      return !meets(row, { ...condition, operator: "equals" }, schema);
    case "contains":
      if (wanted === undefined) return false;
      // A list contains an item; text contains text.
      return Array.isArray(value)
        ? is((item) => sameText(item, wanted))
        : is((item) => textOf(item).includes(textOf(wanted)));
    case "notContains":
      return !meets(row, { ...condition, operator: "contains" }, schema);
    case "startsWith":
      return wanted !== undefined && is((item) => textOf(item).startsWith(textOf(wanted)));
    case "endsWith":
      return wanted !== undefined && is((item) => textOf(item).endsWith(textOf(wanted)));
    case "greaterThan":
    case "after": {
      const order = compareOrder(value, wanted, kind);
      return order !== undefined && order > 0;
    }
    case "greaterOrEqual":
    case "onOrAfter": {
      const order = compareOrder(value, wanted, kind);
      return order !== undefined && order >= 0;
    }
    case "lessThan":
    case "before": {
      const order = compareOrder(value, wanted, kind);
      return order !== undefined && order < 0;
    }
    case "lessOrEqual":
    case "onOrBefore": {
      const order = compareOrder(value, wanted, kind);
      return order !== undefined && order <= 0;
    }
  }
}

/** Whether a row passes a filter, its groups' conditions all or any met. */
export function matches(row: Row, filter: Filter, schema: DatabaseSchema): boolean {
  if ("and" in filter) return filter.and.every((part) => matches(row, part, schema));
  if ("or" in filter) return filter.or.some((part) => matches(row, part, schema));
  return meets(row, filter, schema);
}

/** Orders two values of a property, empty ones last in either direction. */
function compareValues(
  a: JsonValue | undefined,
  b: JsonValue | undefined,
  kind: Kind | undefined,
  options: readonly string[],
): number {
  if (kind === "checkbox") return Number(a === true) - Number(b === true);
  const first = itemsOf(a)[0];
  const second = itemsOf(b)[0];
  if (kind === "select" || kind === "multiSelect") {
    // In the options' order, as a status goes from to do to done; values
    // that are no option after them.
    const rank = (value: JsonValue | undefined) => {
      const at = options.findIndex((option) => value !== undefined && sameText(option, value));
      return at === -1 ? options.length : at;
    };
    const order = rank(first) - rank(second);
    if (order !== 0) return order;
  }
  const order = compareOrder(first, second, kind);
  return order ?? textOf(first ?? "").localeCompare(textOf(second ?? ""));
}

/** Rows in the order of a view's sorts, then by title, as a file explorer sorts. */
export function sortRows(
  rows: readonly Row[],
  sorts: readonly Sort[],
  schema: DatabaseSchema,
): Row[] {
  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const left = rowValue(a, sort.property);
      const right = rowValue(b, sort.property);
      const kind = kindOf(schema, sort.property);
      // Rows without a value go last whichever way the sort goes.
      if (kind !== "checkbox" && isEmpty(left) !== isEmpty(right)) return isEmpty(left) ? 1 : -1;
      if (kind !== "checkbox" && isEmpty(left)) continue;
      const options = (
        schema.properties.find((property) => property.key === sort.property)?.options ?? []
      ).map((option) => option.name);
      const order = compareValues(left, right, kind, options);
      if (order !== 0) return sort.direction === "ascending" ? order : -order;
    }
    return collator.compare(rowTitle(a), rowTitle(b));
  });
}

/** Rows that share a value of the property a view groups by; `value` is null for those with none. */
export interface Group {
  readonly value: JsonValue;
  readonly rows: readonly Row[];
}

/**
 * Rows grouped by a property: a select's options first, in the schema's
 * order, then other values as rows have them, then rows with none. A row
 * with several values, as a multi-select has, is in each of their groups.
 */
export function groupRows(rows: readonly Row[], key: string, schema: DatabaseSchema): Group[] {
  const kind = kindOf(schema, key);
  const groups = new Map<string, { value: JsonValue; rows: Row[] }>();
  const add = (value: JsonValue, row: Row) => {
    const id = JSON.stringify(typeof value === "string" ? value.toLowerCase() : value);
    const group = groups.get(id);
    if (group === undefined) groups.set(id, { value, rows: [row] });
    else group.rows.push(row);
  };
  if (kind === "checkbox") {
    // Unchecked first, as a to-do list's columns go.
    for (const value of [false, true]) groups.set(JSON.stringify(value), { value, rows: [] });
  }
  for (const option of schema.properties.find((property) => property.key === key)?.options ?? []) {
    groups.set(JSON.stringify(option.name.toLowerCase()), { value: option.name, rows: [] });
  }
  const none: Row[] = [];
  for (const row of rows) {
    const value = rowValue(row, key);
    if (kind === "checkbox") {
      add(value === true, row);
      continue;
    }
    const items = itemsOf(value).filter((item) => !isEmpty(item));
    if (items.length === 0) none.push(row);
    for (const item of new Set(items)) add(item, row);
  }
  // A board of options shows the column of rows with none even when empty.
  const showNone = kind === "select" || kind === "multiSelect" || kind === "person";
  return [
    ...[...groups.values()].map(({ value, rows: grouped }) => ({ value, rows: grouped })),
    ...(none.length === 0 && !showNone ? [] : [{ value: null, rows: none }]),
  ];
}

/** A view's rows: filtered, sorted, and grouped when it groups. */
export interface ViewResult {
  readonly rows: readonly Row[];
  readonly groups?: readonly Group[];
}

/** Runs a view over a database's rows. */
export function runView(rows: readonly Row[], view: View, schema: DatabaseSchema): ViewResult {
  const filter = view.filter;
  const kept = filter === undefined ? rows : rows.filter((row) => matches(row, filter, schema));
  const sorted = sortRows(kept, view.sorts ?? [], schema);
  return view.groupBy === undefined
    ? { rows: sorted }
    : { rows: sorted, groups: groupRows(sorted, view.groupBy, schema) };
}
