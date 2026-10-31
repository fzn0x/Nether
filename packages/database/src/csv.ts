// A database's view as CSV (ADR 0022): the rows its filter keeps, in its
// order, each with its name and the properties the view shows, as
// spreadsheets open it: UTF-8 after a byte order mark, quoted where a cell
// needs it, and each line ended as RFC 4180 ends them.
import type { DatabaseSchema, JsonValue, View } from "@nether/core";
import { runView } from "./query.ts";
import { type Row, linkName, rowTitle, rowValue } from "./rows.ts";

/** A value as a cell: a list's items between commas, a link as the name of its note. */
export function cellText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    const items: readonly JsonValue[] = value;
    return items
      .map((item) => cellText(item))
      .filter((text) => text !== "")
      .join(", ");
  }
  if (typeof value === "string") return linkName(value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A cell as CSV writes it: in quotes, its quotes doubled, when it holds a comma, a quote or a line break. */
function field(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Lines of cells as a CSV file's text. */
export function toCsv(lines: readonly (readonly string[])[]): string {
  // The byte order mark tells spreadsheets the text is UTF-8.
  return `\uFEFF${lines.map((line) => `${line.map(field).join(",")}\r\n`).join("")}`;
}

/**
 * A view of a database as a CSV file's text: a header of the name column,
 * called `nameHeader`, and the view's properties, then a line for each row
 * the view keeps, in its order. Rows come with their rollups and formulas
 * worked out; a formula that fails for a row leaves its cell empty.
 */
export function viewCsv(
  rows: readonly Row[],
  view: View,
  schema: DatabaseSchema,
  nameHeader: string,
): string {
  const keys = view.visible.filter((key) =>
    schema.properties.some((property) => property.key === key),
  );
  const kept = runView(rows, view, schema).rows;
  return toCsv([
    [nameHeader, ...keys],
    ...kept.map((row) => [rowTitle(row), ...keys.map((key) => cellText(rowValue(row, key)))]),
  ]);
}
