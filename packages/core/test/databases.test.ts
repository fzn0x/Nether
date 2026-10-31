import { describe, expect, it } from "vitest";
import { checkRow, noteFromJson, readDatabaseSchema } from "../src/index.ts";
import { at, databaseNote, edit, ids } from "./fixtures.ts";

type Json = Record<string, unknown>;
const schemaOf = (note: Json) => note.database as Json;
const views = (note: Json) => schemaOf(note).views as Json[];

function rejects(note: Json, message: string): void {
  expect(() => noteFromJson(note)).toThrow(message);
}

function withView(view: Json): Json {
  return edit(databaseNote(), (note) => {
    schemaOf(note).views = [{ id: ids.view, name: "View", visible: [], ...view }];
  });
}

describe("database schemas", () => {
  it("reject repeated property keys, view IDs and view names", () => {
    rejects(
      edit(databaseNote(), (note) => {
        (schemaOf(note).properties as Json[]).push({ key: "status", type: "text" });
      }),
      'note.database.properties[12].key repeats the property "status"',
    );
    rejects(
      edit(databaseNote(), (note) => {
        at(views(note), 1).id = ids.view;
      }),
      `note.database.views[1].id repeats the view ID "${ids.view}"`,
    );
    rejects(
      edit(databaseNote(), (note) => {
        at(views(note), 1).name = at(views(note), 0).name;
      }),
      "note.database.views[1].name repeats the view name",
    );
  });

  it.each([
    [
      { layout: "table", visible: ["missing"] },
      'note.database.views[0].visible[0] names no property of the database: "missing"',
    ],
    [
      { layout: "table", visible: ["status", "status"] },
      "note.database.views[0].visible lists a property twice",
    ],
    [{ layout: "table", visible: ["$owner"] }, 'names no property of the database: "$owner"'],
    [{ layout: "chart" }, "note.database.views[0].layout must be one of"],
    [{ layout: "board" }, "note.database.views[0].groupBy is needed by a board"],
    [
      { layout: "board", groupBy: "summary" },
      "note.database.views[0].groupBy must be a select, multi-select, checkbox or person property",
    ],
    [{ layout: "calendar" }, "note.database.views[0].date is needed by a calendar"],
    [
      { layout: "calendar", date: "summary" },
      "note.database.views[0].date must be a date property",
    ],
    [
      { layout: "timeline", date: "due", end: "estimate" },
      "note.database.views[0].end must be a date property",
    ],
    [
      { layout: "table", date: "due" },
      "note.database.views[0].date is only for calendars and timelines",
    ],
    [
      { layout: "calendar", date: "due", end: "ends" },
      "note.database.views[0].end is only for timelines",
    ],
    [{ layout: "table", cover: "cover" }, "note.database.views[0].cover is only for galleries"],
    [
      { layout: "gallery", cover: "summary" },
      "note.database.views[0].cover must be a file property",
    ],
    [{ layout: "table", name: "" }, "note.database.views[0].name must not be empty"],
    [
      { layout: "table", sorts: [{ property: "due", direction: "up" }] },
      "note.database.views[0].sorts[0].direction must be one of",
    ],
    [
      { layout: "table", sorts: [{ property: "gone", direction: "ascending" }] },
      "note.database.views[0].sorts[0].property names no property",
    ],
  ])("rejects the view %j", (view, message) => {
    rejects(withView(view), message);
  });

  it.each([
    [
      { property: "status", operator: "equals" },
      "note.database.views[0].filter.value is needed by equals",
    ],
    [
      { property: "status", operator: "isEmpty", value: 1 },
      "note.database.views[0].filter.value is not used by isEmpty",
    ],
    [
      { property: "status", operator: "like", value: 1 },
      "note.database.views[0].filter.operator must be one of",
    ],
    [
      { property: "gone", operator: "isEmpty" },
      "note.database.views[0].filter.property names no property",
    ],
    [{ and: [] }, "note.database.views[0].filter.and needs at least one filter"],
    [
      { and: [{ property: "status", operator: "isEmpty" }], or: [] },
      "note.database.views[0].filter has both and and or",
    ],
    [
      { or: [{ and: [{ property: "due", operator: "before" }] }] },
      "note.database.views[0].filter.or[0].and[0].value is needed by before",
    ],
  ])("rejects the filter %j", (filter, message) => {
    rejects(withView({ layout: "table", filter }), message);
  });

  it("rejects filter groups nested deeper than eight levels", () => {
    let filter: Json = { property: "status", operator: "isEmpty" };
    for (let depth = 0; depth < 10; depth++) filter = { and: [filter] };
    rejects(withView({ layout: "table", filter }), "nests filter groups deeper than 8 levels");
  });

  it("let views use the built-in title and timestamps", () => {
    const schema = readDatabaseSchema(
      {
        properties: [],
        views: [
          {
            id: ids.view,
            name: "Recent",
            layout: "calendar",
            visible: ["$title"],
            date: "$updated",
            sorts: [{ property: "$created", direction: "descending" }],
          },
        ],
      },
      "schema",
    );
    expect(schema.views[0]?.date).toBe("$updated");
  });
});

describe("checkRow", () => {
  const schema = noteFromJson(databaseNote()).database;
  if (schema === undefined) throw new Error("the fixture is a database");

  it("accepts values of the schema's types, empty values and properties outside the schema", () => {
    expect(() => {
      checkRow(
        [
          { key: "status", value: "Done" },
          { key: "due", value: null },
          { key: "blocks", value: [ids.row] },
          { key: "not in the schema", value: { any: ["thing"] } },
        ],
        schema,
        "row.properties",
      );
    }).not.toThrow();
  });

  it("rejects a value of the wrong type", () => {
    expect(() => {
      checkRow([{ key: "estimate", value: "three" }], schema, "row.properties");
    }).toThrow("row.properties[0].value does not fit a number property");
  });
});

describe("formulas", () => {
  const schema = (property: Record<string, unknown>) =>
    readDatabaseSchema({ properties: [{ key: "total", ...property }], views: [] }, "schema");

  it("read an expression on one line, and refuse one missing, empty, too long or elsewhere", () => {
    expect(schema({ type: "formula", formula: "price * 2" }).properties[0]).toEqual({
      key: "total",
      type: "formula",
      formula: "price * 2",
    });
    expect(() => schema({ type: "formula" })).toThrow("schema.properties[0].formula is missing");
    expect(() => schema({ type: "formula", formula: "  " })).toThrow(
      "schema.properties[0].formula is empty",
    );
    expect(() => schema({ type: "formula", formula: "1+".repeat(1001) })).toThrow(
      "is longer than 2000 characters",
    );
    expect(() => schema({ type: "formula", formula: "a\nb" })).toThrow(
      "schema.properties[0].formula",
    );
    expect(() => schema({ type: "text", formula: "1" })).toThrow(
      "schema.properties[0].formula is only for formula properties",
    );
  });
});

describe("rollups", () => {
  const clients = "01929f4c-7b00-7a00-8000-000000000001";
  const schema = (rollup: unknown, type = "rollup") =>
    readDatabaseSchema(
      {
        properties: [
          { key: "client", type: "relation", relation: { database: clients } },
          { key: "budget", type, rollup },
        ],
        views: [],
      },
      "schema",
    );

  it("read a relation of the database, a property of its rows and a function", () => {
    expect(
      schema({ relation: "client", property: "Budget", function: "sum" }).properties[1],
    ).toEqual({
      key: "budget",
      type: "rollup",
      rollup: { relation: "client", property: "Budget", function: "sum" },
    });
  });

  it("refuse a rollup without one, of another type, or of a property that is no relation", () => {
    expect(() => schema(undefined)).toThrow("schema.properties[1].rollup is missing");
    expect(() => schema({ relation: "client", property: "x", function: "sum" }, "text")).toThrow(
      "schema.properties[1].rollup is only for rollup properties",
    );
    expect(() => schema({ relation: "client", property: "x", function: "median" })).toThrow(
      "schema.properties[1].rollup.function must be one of",
    );
    expect(() => schema({ relation: "budget", property: "x", function: "count" })).toThrow(
      'schema.properties[1].rollup.relation names no relation of the database: "budget"',
    );
  });

  it("take any value a row's file has, as a rollup's is worked out", () => {
    const read = schema({ relation: "client", property: "x", function: "count" });
    expect(() => {
      checkRow([{ key: "budget", value: { any: "thing" } }], read, "row");
    }).not.toThrow();
  });
});
