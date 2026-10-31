// Rollups: worked out for each row from the rows its relation links it to.
import type { JsonValue, NoteId, Rollup, View } from "@nether/core";
import { describe, expect, it } from "vitest";
import {
  type FindRow,
  type Row,
  linkName,
  readBase,
  readDatabase,
  rollupValue,
  rowTitle,
  runView,
  viewIdOf,
  withRollups,
  writeBase,
} from "../src/index.ts";

let next = 0;
function row(path: string, values: Record<string, JsonValue>): Row {
  next++;
  return {
    id: `01929f4c-7b00-7a00-8000-${String(next).padStart(12, "0")}` as NoteId,
    path,
    updated: 0,
    properties: Object.entries(values).map(([key, value]) => ({ key, value })),
  };
}

const tasks = [
  row("Tasks/Design.md", { estimate: 3, due: "2026-11-20" }),
  row("Tasks/Build.md", { estimate: 8, due: "2026-11-05T09:00" }),
  row("Tasks/Ship.md", { estimate: null, due: "2026-12-01" }),
];
const find: FindRow = (link) => tasks.find((task) => rowTitle(task) === linkName(link));

const launch = row("Projects/Launch.md", {
  tasks: ["[[Design]]", "[[Build]]", "[[Tasks/Design|again]]", "[[Missing]]", "[[Ship]]"],
  // A stale value in the file, which a rollup does not read.
  hours: 999,
});
const idle = row("Projects/Idle.md", {});

const rollup = (property: string, fn: Rollup["function"]): Rollup => ({
  relation: "tasks",
  property,
  function: fn,
});

describe("rollupValue", () => {
  it("works out each function over the rows a relation links, each row once", () => {
    expect(rollupValue(launch, rollup("estimate", "count"), find)).toBe(3);
    expect(rollupValue(launch, rollup("estimate", "countValues"), find)).toBe(2);
    expect(rollupValue(launch, rollup("estimate", "sum"), find)).toBe(11);
    expect(rollupValue(launch, rollup("estimate", "average"), find)).toBe(5.5);
    expect(rollupValue(launch, rollup("estimate", "min"), find)).toBe(3);
    expect(rollupValue(launch, rollup("estimate", "max"), find)).toBe(8);
    expect(rollupValue(launch, rollup("due", "earliest"), find)).toBe("2026-11-05");
    expect(rollupValue(launch, rollup("due", "latest"), find)).toBe("2026-12-01");
    expect(rollupValue(launch, rollup("$title", "countValues"), find)).toBe(3);
  });

  it("gives nothing where there is nothing to work out", () => {
    expect(rollupValue(idle, rollup("estimate", "count"), find)).toBe(0);
    for (const fn of ["sum", "average", "min", "max", "earliest", "latest"] as const) {
      expect(
        rollupValue(
          idle,
          rollup(fn === "earliest" || fn === "latest" ? "due" : "estimate", fn),
          find,
        ),
      ).toBeNull();
    }
  });
});

const schema = readDatabase(
  {
    properties: [
      { key: "tasks", type: "relation", relation: { database: "[[Tasks]]" } },
      { key: "hours", type: "rollup", rollup: rollup("estimate", "sum") },
      { key: "next", type: "rollup", rollup: rollup("due", "earliest") },
      { key: "status", type: "select", options: [] },
    ],
    views: [
      {
        name: "Busy",
        layout: "table",
        visible: ["status", "hours", "next"],
        filter: { property: "hours", operator: "greaterThan", value: 1 },
        sorts: [{ property: "next", direction: "ascending" }],
      },
    ],
  },
  () => "01929f4c-7b00-7a00-8000-0000000000ff" as NoteId,
);

describe("withRollups", () => {
  it("puts each rollup's value in place of the file's, for views to filter and sort", () => {
    const rows = withRollups([launch, idle], schema, find);
    expect(rows[0]?.properties).toEqual([
      { key: "tasks", value: launch.properties[0]?.value ?? null },
      { key: "hours", value: 11 },
      { key: "next", value: "2026-11-05" },
    ]);
    const view = schema.views[0];
    if (view === undefined) throw new Error("The view is missing.");
    expect(runView(rows, view, schema).rows.map(rowTitle)).toEqual(["Launch"]);
    const byDate: View = {
      id: viewIdOf("Dates"),
      name: "Dates",
      layout: "table",
      visible: [],
      filter: { property: "next", operator: "before", value: "2026-11-06" },
    };
    expect(runView(rows, byDate, schema).rows.map(rowTitle)).toEqual(["Launch"]);
    expect(withRollups([idle], { properties: [], views: [] }, find)).toEqual([idle]);
  });
});

describe("rollups in the Obsidian base", () => {
  it("are left out of it, as Obsidian has no such property, and kept in the view", () => {
    const written = writeBase(schema, "Projects.md");
    expect(written).toContain("    order:\n      - file.name\n      - status\n");
    expect(written).not.toContain("hours");
    const read = readBase(written, schema);
    expect(read.views[0]?.visible).toEqual(["status", "hours", "next"]);
    expect(read.views[0]?.filter).toEqual(schema.views[0]?.filter);
  });
});
