// Query blocks: a base's YAML, read, and run over a vault's notes.
import type { NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import { FormulaError, type Row, readQuery, runQuery } from "../src/index.ts";

const now = new Date(2026, 10, 12, 15, 30);
let count = 0;
const note = (path: string, properties: Row["properties"], tags: readonly string[] = []): Row => ({
  id: `01929f4c-7b00-7a00-8000-${String(++count).padStart(12, "0")}` as NoteId,
  path,
  updated: new Date(2026, 10, count).getTime(),
  properties,
  tags,
});
const notes: readonly Row[] = [
  note(
    "Projects/Launch.md",
    [
      { key: "status", value: "active" },
      { key: "price", value: 12 },
      { key: "due", value: "2026-11-15" },
      { key: "cover", value: "[[launch.png]]" },
    ],
    ["project/web"],
  ),
  note(
    "Projects/Site.md",
    [
      { key: "status", value: "active" },
      { key: "price", value: 3 },
      { key: "due", value: "2026-11-01" },
    ],
    ["project"],
  ),
  note("Projects/Archive/Old.md", [{ key: "status", value: "done" }], ["project"]),
  note("Inbox.md", [], ["inbox"]),
];

const run = (source: string, view = 0) => {
  const query = readQuery(source);
  const chosen = query.views[view];
  if (chosen === undefined) throw new Error("no view");
  return runQuery(query, chosen, notes, now);
};
const names = (source: string, view = 0) =>
  run(source, view).rows.map((row) => row.path.replace(/^.*\/|\.md$/g, ""));
const fails = (source: string) => {
  try {
    readQuery(source);
  } catch (error) {
    if (error instanceof FormulaError) return error.message;
    throw error;
  }
  return "no error";
};

describe("readQuery", () => {
  it("reads a base's filters, formulas, names and views", () => {
    const query = readQuery(`
filters:
  and:
    - file.inFolder("Projects")
    - not:
        - file.hasTag("archive")
formulas:
  total: price * 2
properties:
  note.status:
    displayName: State
views:
  - type: list
    name: Active
    order: [file.name, note.status, formula.total]
    sort:
      - property: note.price
        direction: desc
    groupBy:
      property: note.status
    limit: 5
    image: note.cover
`);
    expect(query.filter).toMatchObject({
      and: [{ expression: {} }, { not: [{ expression: {} }] }],
    });
    expect([...query.formulas.keys()]).toEqual(["total"]);
    expect(query.names.get("note.status")).toBe("State");
    expect(query.views).toEqual([
      {
        name: "Active",
        type: "list",
        order: ["file.name", "note.status", "formula.total"],
        sort: [{ property: "note.price", direction: "DESC" }],
        groupBy: { property: "note.status", direction: "ASC" },
        limit: 5,
        image: "note.cover",
      },
    ]);
  });

  it("makes a table of every note's name from an empty block, and names a view by its type", () => {
    expect(readQuery("").views).toEqual([
      { name: "Table", type: "table", order: ["file.name"], sort: [] },
    ]);
    expect(readQuery("views:\n  - type: cards").views[0]?.name).toBe("Cards");
  });

  it("says why it cannot read a block", () => {
    expect(fails("filters: [")).toMatch(/^The query cannot be read: /);
    expect(fails("- a\n- b")).toBe("The query is not a base: a list of its settings");
    expect(fails("filters: 'price >'")).toBe("The filters: The formula ends too soon");
    expect(fails("filters:\n  all: [a]")).toBe(
      'The filters: a filter is an expression, or "and", "or" or "not" with a list of filters',
    );
    expect(fails("views:\n  - name: A\n    filters: 'x +'")).toBe(
      'The view "A"\'s filters: The formula ends too soon',
    );
    expect(fails("views:\n  - name: A\n    sort: [status]")).toBe(
      'The view "A"\'s sort: a sort names a property, and a direction, ASC or DESC',
    );
    expect(fails("views:\n  - name: A\n    limit: many")).toBe(
      'The view "A"\'s limit is not a number of notes',
    );
    expect(fails("views: [3]")).toBe("View 1 is not a list of its settings");
    expect(fails("formulas:\n  a: [1]")).toBe("The formula a is not an expression");
  });
});

describe("runQuery", () => {
  it("finds notes anywhere by folder, tag or property", () => {
    expect(names('filters: file.inFolder("Projects")')).toEqual(["Launch", "Old", "Site"]);
    expect(names('filters: file.hasTag("project/web")')).toEqual(["Launch"]);
    expect(names('filters: status == "active"')).toEqual(["Launch", "Site"]);
    expect(names('filters: file.hasProperty("status")')).toHaveLength(3);
    expect(names("filters:\n  or: ['status == \"done\"', 'file.hasTag(\"inbox\")']")).toEqual([
      "Inbox",
      "Old",
    ]);
    expect(names("filters:\n  not: ['file.inFolder(\"Projects\")']")).toEqual(["Inbox"]);
    // The base's filters and the view's both hold.
    expect(
      names('filters: file.inFolder("Projects")\nviews:\n  - type: table\n    filters: price > 5'),
    ).toEqual(["Launch"]);
    // Text that is a date reads as one.
    expect(names("filters: due < today()")).toEqual(["Site"]);
  });

  it("sorts, without values last either way, then by name, and stops at its limit", () => {
    const source = (direction: string, limit = "") => `
filters: file.inFolder("Projects")
views:
  - type: table
    sort:
      - property: price
        direction: ${direction}
${limit}`;
    expect(names(source("ASC"))).toEqual(["Site", "Launch", "Old"]);
    expect(names(source("DESC"))).toEqual(["Launch", "Site", "Old"]);
    const limited = run(source("DESC", "    limit: 1"));
    expect(limited.rows).toHaveLength(1);
    expect(limited.total).toBe(3);
  });

  it("shows its columns' values by their names, with what a formula cannot work out", () => {
    const result = run(`
filters: file.inFolder("Projects")
formulas:
  total: price * 2
  per: 10 / (price - 3)
properties:
  formula.total:
    displayName: Total
views:
  - type: table
    order: [file.name, note.status, formula.total, file.mtime, formula.per, status, note.per]
    sort:
      - property: file.name
        direction: DESC
`);
    expect(result.columns).toEqual([
      { property: "note.status", label: "status" },
      { property: "formula.total", label: "Total" },
      { property: "file.mtime", label: "file.mtime" },
      { property: "formula.per", label: "per" },
      { property: "note.per", label: "note.per" },
    ]);
    const [site] = result.rows;
    expect(site?.path).toBe("Projects/Site.md");
    expect(site?.properties).toEqual([
      { key: "status", value: "active" },
      { key: "Total", value: 6 },
      { key: "file.mtime", value: "2026-11-02" },
      { key: "per", value: null },
      { key: "note.per", value: null },
    ]);
    expect(site?.errors?.get("per")).toBe("The formula divides by zero");
  });

  it("groups by a value, in its direction, notes without one last", () => {
    const result = run(`
views:
  - type: list
    groupBy:
      property: status
      direction: DESC
`);
    expect(result.groups?.map((group) => [group.value, group.rows.length])).toEqual([
      ["done", 1],
      ["active", 2],
      [null, 1],
    ]);
  });

  it("finds each card's image, and says why a filter failed for a note", () => {
    const cards = run("views:\n  - type: cards\n    image: note.cover");
    expect([...cards.images.values()]).toEqual(["[[launch.png]]"]);
    const failing = run("filters: status.lower() == 3 || price.nothing()");
    expect(failing.rows).toEqual([]);
    expect(failing.error).toBe("Launch: a number has no nothing()");
  });
});
