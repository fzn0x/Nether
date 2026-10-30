// A database's schema as its note's frontmatter holds it, read and written.
import { type NoteId, readDatabaseSchema } from "@nether/core";
import { parseMarkdown } from "@nether/markdown";
import { describe, expect, it } from "vitest";
import { databaseOf, readDatabase, viewIdOf, writeDatabase } from "../src/index.ts";

const clients = "01929f4c-7b00-7a00-8000-000000000001" as NoteId;
const resolve = (link: string) => (link === "[[Clients]]" ? clients : undefined);
const linkTo = (note: NoteId) => (note === clients ? "[[Clients]]" : "[[?]]");

// The example of ADR 0018, as a note's file holds it.
const note = `---
database:
  properties:
    - key: status
      type: select
      options:
        - name: Doing
          color: blue
        - name: Done
          color: green
    - key: due
      type: date
    - key: client
      type: relation
      relation:
        database: "[[Clients]]"
  views:
    - name: Board
      layout: board
      groupBy: status
      visible: [due]
    - name: All
      layout: table
      visible: [status, due, client]
      sorts:
        - property: due
          direction: ascending
---
The project database.
`;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("readDatabase", () => {
  it("reads a note's schema, naming views by name and relations by link", () => {
    const schema = databaseOf(parseMarkdown(note).properties, resolve);
    expect(schema?.properties).toEqual([
      {
        key: "status",
        type: "select",
        options: [
          { name: "Doing", color: "blue" },
          { name: "Done", color: "green" },
        ],
      },
      { key: "due", type: "date" },
      { key: "client", type: "relation", relation: { database: clients } },
    ]);
    expect(schema?.views.map((view) => [view.id, view.name, view.layout])).toEqual([
      [viewIdOf("Board"), "Board", "board"],
      [viewIdOf("All"), "All", "table"],
    ]);
    expect(schema?.views[0]?.groupBy).toBe("status");
    expect(schema?.views[1]?.sorts).toEqual([{ property: "due", direction: "ascending" }]);
  });

  it("finds no database in a note without one", () => {
    expect(databaseOf(parseMarkdown("---\nstatus: Done\n---\nText\n").properties, resolve)).toBe(
      undefined,
    );
  });

  it("refuses what core refuses, and what only a file can get wrong", () => {
    expect(() => readDatabase("a list", resolve)).toThrow("database must be an object");
    const relation = (database: unknown) => ({
      properties: [{ key: "client", type: "relation", relation: { database } }],
      views: [],
    });
    expect(() => readDatabase(relation("[[Nowhere]]"), resolve)).toThrow(
      "database.properties[0].relation.database finds no note: [[Nowhere]]",
    );
    expect(() => readDatabase(relation(7), resolve)).toThrow("must be a link to a database");
    expect(() =>
      readDatabase(
        { properties: [], views: [{ id: viewIdOf("A"), name: "A", layout: "table", visible: [] }] },
        resolve,
      ),
    ).toThrow("database.views[0].id is not written: a view's name names it");
    expect(() =>
      readDatabase(
        {
          properties: [],
          views: [
            { name: "Same", layout: "table", visible: [] },
            { name: "Same", layout: "list", visible: [] },
          ],
        },
        resolve,
      ),
    ).toThrow('database.views[1].name repeats the view name "Same"');
    // Core's own checks still run.
    expect(() =>
      readDatabase(
        { properties: [], views: [{ name: "B", layout: "board", visible: [] }] },
        resolve,
      ),
    ).toThrow("database.views[0].groupBy is needed by a board");
  });
});

describe("viewIdOf", () => {
  it("gives a view the same UUID for the same name, and another for another", () => {
    expect(viewIdOf("Board")).toBe(viewIdOf("Board"));
    expect(viewIdOf("Board")).not.toBe(viewIdOf("board"));
    for (const name of ["Board", "", "Ταμπλό", "A very long name ".repeat(20)]) {
      expect(viewIdOf(name)).toMatch(uuid);
    }
    // Core takes it as a view's ID.
    expect(() =>
      readDatabaseSchema(
        { properties: [], views: [{ id: viewIdOf("x"), name: "x", layout: "list", visible: [] }] },
        "schema",
      ),
    ).not.toThrow();
  });
});

describe("writeDatabase", () => {
  it("writes a schema back as its note held it", () => {
    const value = parseMarkdown(note).properties.find((entry) => entry.key === "database")?.value;
    expect(writeDatabase(readDatabase(value, resolve), linkTo)).toEqual(value);
  });

  it("writes options without a color, and a relation's backlink", () => {
    const schema = readDatabase(
      {
        properties: [
          { key: "tags", type: "multiSelect", options: [{ name: "a" }] },
          {
            key: "client",
            type: "relation",
            relation: { database: "[[Clients]]", backlink: "jobs" },
          },
        ],
        views: [],
      },
      resolve,
    );
    expect(writeDatabase(schema, linkTo)).toEqual({
      properties: [
        { key: "tags", type: "multiSelect", options: [{ name: "a" }] },
        {
          key: "client",
          type: "relation",
          relation: { database: "[[Clients]]", backlink: "jobs" },
        },
      ],
      views: [],
    });
  });
});
