// The Obsidian base beside a database: written from its schema, keeping
// what is Obsidian's, and read back when Obsidian changes it.
import type { DatabaseSchema, View } from "@nether/core";
import { describe, expect, it } from "vitest";
import { basePath, readBase, readDatabase, writeBase } from "../src/index.ts";

const schema = readDatabase(
  {
    properties: [
      { key: "status", type: "select", options: [{ name: "Doing" }, { name: "Done" }] },
      { key: "due", type: "date" },
      { key: "Big points", type: "number" },
      { key: "tags", type: "multiSelect", options: [] },
      { key: "cover", type: "file" },
    ],
    views: [
      { name: "Board", layout: "board", groupBy: "status", visible: ["due"] },
      {
        name: "All",
        layout: "table",
        visible: ["status", "due", "Big points"],
        filter: {
          and: [
            { property: "Big points", operator: "greaterThan", value: 3 },
            { property: "due", operator: "before", value: "2026-12-01" },
          ],
        },
        sorts: [{ property: "due", direction: "ascending" }],
      },
      { name: "Gallery", layout: "gallery", visible: [], cover: "cover" },
      { name: "Week", layout: "calendar", visible: ["status"], date: "due" },
    ],
  },
  () => undefined,
);

const written = writeBase(schema, "Work/Projects.md");

function viewAt(index: number): View {
  const found = schema.views[index];
  if (found === undefined) throw new Error(`No view ${String(index)}.`);
  return found;
}

describe("writeBase", () => {
  it("writes a base beside the database that finds its rows and shows its views", () => {
    expect(basePath("Work/Projects.md")).toBe("Work/Projects.base");
    expect(written).toBe(
      [
        "filters:",
        "  and:",
        '    - file.folder == "Work/Projects"',
        '    - file.ext == "md"',
        "views:",
        "  - type: kanban",
        "    name: Board",
        "    order:",
        "      - file.name",
        "      - due",
        "    groupBy:",
        "      property: status",
        "      direction: ASC",
        "  - type: table",
        "    name: All",
        "    order:",
        "      - file.name",
        "      - status",
        "      - due",
        "      - Big points",
        "    filters:",
        "      and:",
        '        - note["Big points"] > 3',
        '        - due < date("2026-12-01")',
        "  - type: cards",
        "    name: Gallery",
        "    order:",
        "      - file.name",
        "  - type: table",
        "    name: Week",
        "    order:",
        "      - file.name",
        "      - status",
        "",
      ].join("\n"),
    );
  });

  it("keeps what is Obsidian's: other keys, views it has no layout for, and comments", () => {
    const previous = [
      "# Made by Nether, sorted in Obsidian",
      "formulas:",
      "  late: due < today()",
      'filters: file.hasTag("old")',
      "views:",
      "  - type: map",
      "    name: Places",
      "  - type: table",
      "    name: All",
      "    order: [file.name]",
      "    sort:",
      "      - property: due",
      "        direction: DESC",
      "    limit: 10",
      "  - type: kanban",
      "    name: Removed in Nether",
      "    groupBy:",
      "      property: status",
      "      direction: ASC",
      "",
    ].join("\n");
    const next = writeBase(schema, "Work/Projects.md", previous);
    expect(next).toContain("# Made by Nether, sorted in Obsidian");
    expect(next).toContain("formulas:\n  late: due < today()\n");
    // The rows are the database's, whatever the filter said.
    expect(next).toContain('filters:\n  and:\n    - file.folder == "Work/Projects"');
    expect(next).toContain(
      "  - type: table\n    name: All\n    order:\n      - file.name\n      - status\n      - due\n      - Big points\n    sort:\n      - property: due\n        direction: DESC\n    limit: 10\n    filters:",
    );
    expect(next).toContain("  - type: map\n    name: Places\n");
    expect(next).not.toContain("Removed in Nether");
    // The views Nether has come first, in its order, then Obsidian's.
    expect(next.indexOf("name: Board")).toBeLessThan(next.indexOf("name: Places"));
  });

  it("drops a key Nether owns when the view no longer has it, and writes a broken base anew", () => {
    const board = viewAt(0);
    const ungrouped: DatabaseSchema = {
      properties: schema.properties,
      views: [{ id: board.id, name: board.name, layout: "table", visible: board.visible }],
    };
    const next = writeBase(ungrouped, "Projects.md", written);
    expect(next).not.toContain("groupBy");
    expect(writeBase(ungrouped, "Projects.md", "views: [unclosed")).toBe(
      writeBase(ungrouped, "Projects.md"),
    );
  });
});

describe("readBase", () => {
  it("reads back what it wrote, with the views' own settings", () => {
    expect(readBase(written, schema)).toEqual(schema);
  });

  it("reads every filter Nether writes", () => {
    const filtered: DatabaseSchema = {
      properties: schema.properties,
      views: [
        {
          ...viewAt(1),
          filter: {
            or: [
              { property: "status", operator: "equals", value: "Done" },
              { property: "status", operator: "notEquals", value: "Doing" },
              { property: "tags", operator: "contains", value: 'a "quoted" tag' },
              { property: "tags", operator: "notContains", value: "b" },
              { property: "$title", operator: "startsWith", value: "Launch" },
              { property: "$title", operator: "endsWith", value: "site" },
              { property: "Big points", operator: "greaterOrEqual", value: 2.5 },
              { property: "Big points", operator: "lessThan", value: -1 },
              { property: "Big points", operator: "lessOrEqual", value: 9 },
              { property: "due", operator: "after", value: "2026-01-01" },
              { property: "due", operator: "onOrBefore", value: "2026-02-01" },
              { property: "$updated", operator: "onOrAfter", value: "2026-03-01" },
              { property: "$created", operator: "equals", value: "2026-04-01" },
              { property: "cover", operator: "isEmpty" },
              { and: [{ property: "cover", operator: "isNotEmpty" }] },
            ],
          },
        },
      ],
    };
    expect(readBase(writeBase(filtered, "Projects.md"), filtered)).toEqual(filtered);
  });

  it("takes Obsidian's edits: columns, grouping, filters, and views added and removed", () => {
    const edited = written
      // Columns reordered and one hidden, in the table.
      .replace(
        "      - status\n      - due\n      - Big points\n",
        "      - Big points\n      - note.status\n",
      )
      // The board grouped by another property.
      .replace("      property: status\n", "      property: tags\n")
      // A list added, a view of a property Nether has not, and a view removed.
      .replace(
        "  - type: cards\n    name: Gallery\n    order:\n      - file.name\n",
        "  - type: list\n    name: Plain\n    order:\n      - file.name\n      - unknown\n      - status\n",
      );
    const read = readBase(edited, schema);
    expect(read.views.map((view) => [view.name, view.layout])).toEqual([
      ["Board", "board"],
      ["All", "table"],
      ["Plain", "list"],
      ["Week", "calendar"],
    ]);
    expect(read.views[0]?.groupBy).toBe("tags");
    expect(read.views[1]?.visible).toEqual(["Big points", "status"]);
    expect(read.views[1]?.sorts).toEqual([{ property: "due", direction: "ascending" }]);
    expect(read.views[2]?.visible).toEqual(["status"]);
    expect(read.views[3]?.date).toBe("due");
    expect(read.properties).toBe(schema.properties);
  });

  it("leaves what it cannot read as the schema had it", () => {
    // A filter with a function Nether has not keeps the view's own, and stays in the base.
    const tagged = written.replace('due < date("2026-12-01")', 'file.hasTag("x")');
    const own = readBase(tagged, schema);
    expect(own.views[1]?.filter).toEqual(schema.views[1]?.filter);
    expect(writeBase(own, "Work/Projects.md", tagged)).toBe(tagged);
    // A board with nothing to group by stays as it was.
    const board = readBase(
      written.replace("    groupBy:\n      property: status\n      direction: ASC\n", ""),
      schema,
    );
    expect(board.views[0]).toEqual(schema.views[0]);
    // A new board with nothing to group by is left out.
    expect(
      readBase(`${written}  - type: kanban\n    name: New\n`, schema).views.map(
        (view) => view.name,
      ),
    ).not.toContain("New");
    for (const text of ["views: [unclosed", "just text", "views: 3", ""]) {
      expect(readBase(text, schema)).toBe(schema);
    }
  });
});
