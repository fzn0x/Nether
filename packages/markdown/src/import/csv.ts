// A CSV table as a database (ADRs 0018 and 0027): a note whose properties
// are the table's columns, beside a folder with a note for each line, named
// by its first cell, the others its frontmatter. A column's type is the one
// every value in it reads as, a number, a date, a checkbox or a web
// address, or else text, so no value changes as it is read. A name a file
// cannot hold is kept as the row's alias.
import type { JsonValue, PropertyEntry } from "@nether/core";
import { serializeMarkdown } from "../serialize.ts";
import { type ImportPlan, freeNames, safeName, within } from "./plan.ts";

/** A CSV file's lines and cells, as RFC 4180 reads them: quoted cells, doubled quotes, any line ending. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let at = text.startsWith("\uFEFF") ? 1 : 0;
  while (at < text.length) {
    const char = text[at] ?? "";
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        cell += '"';
        at += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else cell += char;
      at++;
      continue;
    }
    if (char === '"' && cell === "") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" || char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && text[at + 1] === "\n") at++;
    } else cell += char;
    at++;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

type ColumnType = "number" | "date" | "checkbox" | "url" | "text";

const readers: readonly { type: ColumnType; test: RegExp }[] = [
  // Not 007 or 1,000, which would lose their writing as numbers.
  { type: "number", test: /^-?(0|[1-9]\d*)(\.\d+)?$/ },
  { type: "date", test: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/ },
  { type: "checkbox", test: /^(true|false|yes|no)$/i },
  { type: "url", test: /^https?:\/\/\S+$/i },
];

/** The type every value of a column reads as, empty ones aside. */
function columnType(values: readonly string[]): ColumnType {
  const written = values.map((value) => value.trim()).filter((value) => value !== "");
  if (written.length === 0) return "text";
  return (
    readers.find((reader) => written.every((value) => reader.test.test(value)))?.type ?? "text"
  );
}

function valueOf(text: string, type: ColumnType): JsonValue {
  const value = text.trim();
  switch (type) {
    case "number":
      return Number(value);
    case "checkbox":
      return /^(true|yes)$/i.test(value);
    case "date":
    case "url":
      return value;
    case "text":
      return text;
  }
}

/**
 * Plans a CSV table's import as a database named `name` in the vault's
 * folder `into`: the database's note, and a note for each row in the
 * folder beside it.
 */
export function planCsv(name: string, text: string, into: string): ImportPlan {
  const database = safeName(name, "Table");
  const [header = [], ...lines] = parseCsv(text).filter((line) =>
    line.some((cell) => cell.trim() !== ""),
  );
  // A line with more cells than the header has columns: the rest go to columns of their own.
  const width = Math.max(header.length, ...lines.map((line) => line.length));
  const keyName = freeNames();
  const keys = Array.from({ length: width }, (_, column) =>
    keyName(
      (header[column] ?? "").trim() === ""
        ? `Column ${String(column + 1)}`
        : (header[column] ?? "").trim(),
    ),
  );
  const warnings: string[] = [];
  if (width > header.length) {
    warnings.push(
      `${name}: some lines have more cells than the header has columns; they are in ${keys.slice(header.length).join(", ")}.`,
    );
  }
  const properties = keys.slice(1);
  const types = properties.map((_, column) =>
    columnType(lines.map((line) => line[column + 1] ?? "")),
  );
  const schema: JsonValue = {
    properties: properties.map((key, column) => ({ key, type: types[column] ?? "text" })),
    views: [{ name: "Table", layout: "table", visible: properties }],
  };
  const notes = [
    {
      path: within(into, `${database}.md`),
      text: serializeMarkdown({ properties: [{ key: "database", value: schema }], content: [] })
        .text,
    },
  ];
  const rowName = freeNames();
  for (const line of lines) {
    const written = (line[0] ?? "").trim();
    const safe = safeName(written);
    const title = rowName(safe);
    const entries: PropertyEntry[] = [];
    // A name a file cannot hold, kept where links and search find it.
    if (written !== "" && safe !== written) entries.push({ key: "aliases", value: [written] });
    properties.forEach((key, column) => {
      const cell = line[column + 1] ?? "";
      if (cell.trim() === "") return;
      entries.push({ key, value: valueOf(cell, types[column] ?? "text") });
    });
    notes.push({
      path: within(into, `${database}/${title}.md`),
      text: serializeMarkdown({ properties: entries, content: [] }).text,
    });
  }
  return { notes, files: [], warnings };
}
