// A view's rows: filtered, sorted and grouped.
import type { Filter, JsonValue, NoteId, View } from "@nether/core";
import { describe, expect, it } from "vitest";
import {
  type Row,
  groupRows,
  matches,
  readDatabase,
  rowTitle,
  runView,
  sortRows,
} from "../src/index.ts";

const schema = readDatabase(
  {
    properties: [
      {
        key: "status",
        type: "select",
        options: [{ name: "Todo" }, { name: "Doing" }, { name: "Done" }],
      },
      { key: "tags", type: "multiSelect", options: [] },
      { key: "due", type: "date" },
      { key: "points", type: "number" },
      { key: "done", type: "checkbox" },
      { key: "owner", type: "person" },
      { key: "notes", type: "text" },
    ],
    views: [],
  },
  () => undefined,
);

let next = 0;
function row(title: string, values: Record<string, JsonValue>, updated = 0): Row {
  next++;
  return {
    id: `01929f4c-7b00-7a00-8000-${String(next).padStart(12, "0")}` as NoteId,
    path: `Projects/${title}.md`,
    updated,
    properties: Object.entries(values).map(([key, value]) => ({ key, value })),
  };
}

const day = (text: string) => new Date(`${text}T12:00:00`).getTime();
const rows = [
  row(
    "Launch",
    {
      status: "Doing",
      tags: ["web", "launch"],
      due: "2026-11-15",
      points: 8,
      done: false,
      notes: "Ship the site",
    },
    day("2026-10-01"),
  ),
  row(
    "Docs",
    { status: "done", tags: ["docs"], due: "2026-11-01", points: 3, done: true },
    day("2026-10-20"),
  ),
  row(
    "Plan",
    { status: "Todo", due: "2026-11-15T09:30", points: 5, owner: "[[Ada]]" },
    day("2026-10-31"),
  ),
  row("Idea", { status: "Someday", notes: "" }, day("2026-10-31")),
  row("Empty", {}),
];

const titles = (list: readonly Row[]) => list.map(rowTitle);
const where = (filter: Filter) => titles(rows.filter((item) => matches(item, filter, schema)));

describe("matches", () => {
  it("compares selects and text case aside, and lists by their items", () => {
    expect(where({ property: "status", operator: "equals", value: "Done" })).toEqual(["Docs"]);
    expect(where({ property: "status", operator: "notEquals", value: "done" })).toEqual([
      "Launch",
      "Plan",
      "Idea",
      "Empty",
    ]);
    expect(where({ property: "tags", operator: "contains", value: "WEB" })).toEqual(["Launch"]);
    expect(where({ property: "tags", operator: "equals", value: "docs" })).toEqual(["Docs"]);
    expect(where({ property: "tags", operator: "notContains", value: "web" })).toEqual([
      "Docs",
      "Plan",
      "Idea",
      "Empty",
    ]);
    expect(where({ property: "notes", operator: "contains", value: "the SITE" })).toEqual([
      "Launch",
    ]);
    expect(where({ property: "$title", operator: "startsWith", value: "la" })).toEqual(["Launch"]);
    expect(where({ property: "$title", operator: "endsWith", value: "AN" })).toEqual(["Plan"]);
    expect(where({ property: "owner", operator: "equals", value: "[[Ada]]" })).toEqual(["Plan"]);
  });

  it("compares numbers by value and dates by day, a time aside", () => {
    expect(where({ property: "points", operator: "greaterThan", value: 3 })).toEqual([
      "Launch",
      "Plan",
    ]);
    expect(where({ property: "points", operator: "greaterOrEqual", value: 5 })).toEqual([
      "Launch",
      "Plan",
    ]);
    expect(where({ property: "points", operator: "lessThan", value: 5 })).toEqual(["Docs"]);
    expect(where({ property: "points", operator: "lessOrEqual", value: 5 })).toEqual([
      "Docs",
      "Plan",
    ]);
    expect(where({ property: "due", operator: "equals", value: "2026-11-15" })).toEqual([
      "Launch",
      "Plan",
    ]);
    expect(where({ property: "due", operator: "before", value: "2026-11-15" })).toEqual(["Docs"]);
    expect(where({ property: "due", operator: "onOrBefore", value: "2026-11-15" })).toEqual([
      "Launch",
      "Docs",
      "Plan",
    ]);
    expect(where({ property: "due", operator: "after", value: "2026-11-01" })).toEqual([
      "Launch",
      "Plan",
    ]);
    expect(where({ property: "due", operator: "onOrAfter", value: "2026-11-15" })).toEqual([
      "Launch",
      "Plan",
    ]);
    // A file's time is a day too.
    expect(where({ property: "$updated", operator: "onOrAfter", value: "2026-10-20" })).toEqual([
      "Docs",
      "Plan",
      "Idea",
    ]);
    expect(where({ property: "$updated", operator: "equals", value: "2026-10-31" })).toEqual([
      "Plan",
      "Idea",
    ]);
    // What cannot be compared does not match.
    expect(where({ property: "notes", operator: "greaterThan", value: 1 })).toEqual([]);
  });

  it("counts an empty text or list as empty, and joins conditions in groups", () => {
    expect(where({ property: "notes", operator: "isEmpty" })).toEqual([
      "Docs",
      "Plan",
      "Idea",
      "Empty",
    ]);
    expect(where({ property: "tags", operator: "isNotEmpty" })).toEqual(["Launch", "Docs"]);
    expect(
      where({
        or: [
          { property: "done", operator: "equals", value: true },
          {
            and: [
              { property: "points", operator: "greaterThan", value: 4 },
              { property: "owner", operator: "isNotEmpty" },
            ],
          },
        ],
      }),
    ).toEqual(["Docs", "Plan"]);
  });
});

describe("sortRows", () => {
  it("sorts by each sort in turn, rows with no value last, then by title", () => {
    expect(
      titles(sortRows(rows, [{ property: "points", direction: "ascending" }], schema)),
    ).toEqual(["Docs", "Plan", "Launch", "Empty", "Idea"]);
    expect(
      titles(sortRows(rows, [{ property: "points", direction: "descending" }], schema)),
    ).toEqual(["Launch", "Plan", "Docs", "Empty", "Idea"]);
    expect(
      titles(
        sortRows(
          rows,
          [
            { property: "due", direction: "descending" },
            { property: "$title", direction: "ascending" },
          ],
          schema,
        ),
      ),
    ).toEqual(["Launch", "Plan", "Docs", "Empty", "Idea"]);
    expect(titles(sortRows(rows, [{ property: "done", direction: "descending" }], schema))).toEqual(
      ["Docs", "Empty", "Idea", "Launch", "Plan"],
    );
    expect(
      titles(sortRows(rows, [{ property: "status", direction: "ascending" }], schema)),
    ).toEqual(["Plan", "Launch", "Docs", "Idea", "Empty"]);
    // A select goes in its options' order, a value that is no option after them.
    expect(
      titles(sortRows(rows, [{ property: "status", direction: "descending" }], schema)),
    ).toEqual(["Idea", "Docs", "Launch", "Plan", "Empty"]);
  });
});

describe("groupRows", () => {
  const grouped = (key: string) =>
    groupRows(rows, key, schema).map((group) => [group.value, titles(group.rows)]);

  it("groups a select by its options in order, then other values, then rows with none", () => {
    expect(grouped("status")).toEqual([
      ["Todo", ["Plan"]],
      ["Doing", ["Launch"]],
      ["Done", ["Docs"]],
      ["Someday", ["Idea"]],
      [null, ["Empty"]],
    ]);
  });

  it("puts a row with several values in each of their groups, and checkboxes in two", () => {
    expect(grouped("tags")).toEqual([
      ["web", ["Launch"]],
      ["launch", ["Launch"]],
      ["docs", ["Docs"]],
      [null, ["Plan", "Idea", "Empty"]],
    ]);
    expect(grouped("done")).toEqual([
      [false, ["Launch", "Plan", "Idea", "Empty"]],
      [true, ["Docs"]],
    ]);
    // A board of people shows its column of rows with none, even empty.
    expect(groupRows(rows.slice(2, 3), "owner", schema).map((group) => group.value)).toEqual([
      "[[Ada]]",
      null,
    ]);
    // Other properties show only the groups they have.
    expect(grouped("points").map(([value]) => value)).toEqual([8, 3, 5, null]);
  });
});

describe("runView", () => {
  it("filters, sorts and groups a view's rows", () => {
    const board: View = {
      id: "01929f4c-7b00-7a00-8000-0000000000aa" as View["id"],
      name: "Board",
      layout: "board",
      visible: [],
      groupBy: "status",
      filter: { property: "points", operator: "isNotEmpty" },
      sorts: [{ property: "points", direction: "descending" }],
    };
    const result = runView(rows, board, schema);
    expect(titles(result.rows)).toEqual(["Launch", "Plan", "Docs"]);
    expect(result.groups?.map((group) => [group.value, titles(group.rows)])).toEqual([
      ["Todo", ["Plan"]],
      ["Doing", ["Launch"]],
      ["Done", ["Docs"]],
      [null, []],
    ]);
    const table: View = { id: board.id, name: "Table", layout: "table", visible: [] };
    expect(runView(rows, table, schema).groups).toBeUndefined();
  });
});
