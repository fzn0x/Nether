// Rollups (ADR 0019): a value worked out for each row from the rows its
// relation links it to, when a view shows it, and never written to a row's
// file, where it would go stale as the related rows changed.
import type { DatabaseSchema, JsonValue, PropertyEntry, Rollup } from "@nether/core";
import { rowDate } from "./query.ts";
import { type Row, rowValue } from "./rows.ts";

/** Finds the row a link of a relation names, from the row that holds it. */
export type FindRow = (link: string, from: Row) => Row | undefined;

function itemsOf(value: JsonValue | undefined): readonly JsonValue[] {
  if (value === undefined || value === null) return [];
  const items: readonly JsonValue[] = Array.isArray(value) ? value : [value];
  return items;
}

function isEmpty(value: JsonValue | undefined): boolean {
  return itemsOf(value).every((item) => item === null || item === "");
}

/** A rollup's value for a row, or null when its related rows give none. */
export function rollupValue(row: Row, rollup: Rollup, find: FindRow): JsonValue {
  const related: Row[] = [];
  for (const link of itemsOf(rowValue(row, rollup.relation))) {
    if (typeof link !== "string") continue;
    const found = find(link, row);
    // Each row once, however many links name it.
    if (found !== undefined && !related.some((item) => item.id === found.id)) related.push(found);
  }
  const values = related.map((item) => rowValue(item, rollup.property));
  switch (rollup.function) {
    case "count":
      return related.length;
    case "countValues":
      return values.filter((value) => !isEmpty(value)).length;
    case "earliest":
    case "latest": {
      const days = related
        .map((item) => rowDate(item, rollup.property))
        .filter((day): day is string => day !== undefined)
        .sort();
      return (rollup.function === "earliest" ? days[0] : days[days.length - 1]) ?? null;
    }
    default: {
      const numbers = values
        .flatMap(itemsOf)
        .filter((item): item is number => typeof item === "number");
      if (numbers.length === 0) return null;
      const sum = numbers.reduce((total, number) => total + number, 0);
      if (rollup.function === "sum") return sum;
      if (rollup.function === "average") return sum / numbers.length;
      return rollup.function === "min" ? Math.min(...numbers) : Math.max(...numbers);
    }
  }
}

/**
 * Rows with each rollup's value in place of whatever their files hold
 * under its key, for views to filter, sort, group and show as any value.
 */
export function withRollups(rows: readonly Row[], schema: DatabaseSchema, find: FindRow): Row[] {
  const rollups = schema.properties.flatMap((property) =>
    property.rollup === undefined ? [] : [{ key: property.key, rollup: property.rollup }],
  );
  if (rollups.length === 0) return [...rows];
  const keys = new Set(rollups.map((item) => item.key));
  return rows.map((row) => {
    const worked: PropertyEntry[] = rollups.map(({ key, rollup }) => ({
      key,
      value: rollupValue(row, rollup, find),
    }));
    return {
      ...row,
      properties: [...row.properties.filter((entry) => !keys.has(entry.key)), ...worked],
    };
  });
}
