// A database's view as CSV: its rows, in its order, with its properties.
import type { DatabaseSchema, NoteId, View } from "@nether/core";
import { describe, expect, it } from "vitest";
import { type Row, cellText, readDatabase, toCsv, viewCsv } from "../src/index.ts";

const row = (name: string, properties: Row["properties"], id: number): Row => ({
  id: `01929f4c-7b00-7a00-8000-${String(id).padStart(12, "0")}` as NoteId,
  path: `Projects/${name}.md`,
  updated: 0,
  properties,
});

describe("cellText", () => {
  it("writes a value as a spreadsheet shows it", () => {
    expect(cellText(undefined)).toBe("");
    expect(cellText(null)).toBe("");
    expect(cellText("Done")).toBe("Done");
    expect(cellText(2.5)).toBe("2.5");
    expect(cellText(true)).toBe("true");
    expect(cellText(["web", null, "launch"])).toBe("web, launch");
    expect(cellText(["[[Clients/Acme|Acme Inc]]", "[[Globex]]"])).toBe("Acme, Globex");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("toCsv", () => {
  it("quotes only the cells that need it, after a byte order mark, with CRLF lines", () => {
    expect(
      toCsv([
        ["a", "b,c"],
        ['say "hi"', "two\nlines"],
        ["", "x\r"],
      ]),
    ).toBe('\uFEFFa,"b,c"\r\n"say ""hi""","two\nlines"\r\n,"x\r"\r\n');
    expect(toCsv([])).toBe("\uFEFF");
  });
});

describe("viewCsv", () => {
  const schema: DatabaseSchema = readDatabase(
    {
      properties: [
        { key: "Status", type: "select", options: [{ name: "To do" }, { name: "Done" }] },
        { key: "Points", type: "number" },
        { key: "Tags", type: "multiSelect" },
        { key: "Notes", type: "text" },
      ],
      views: [],
    },
    () => undefined,
  );
  const rows = [
    row(
      "Launch",
      [
        { key: "Status", value: "Done" },
        { key: "Points", value: 3 },
        { key: "Tags", value: ["web", "launch"] },
        { key: "Notes", value: 'A "big" one' },
      ],
      1,
    ),
    row(
      "Site",
      [
        { key: "Status", value: "To do" },
        { key: "Points", value: 5 },
      ],
      2,
    ),
    row("Old", [{ key: "Status", value: "Done" }], 3),
  ];

  it("writes the rows the view keeps, in its order, with the properties it shows", () => {
    const view: View = {
      id: "01929f4c-7b00-7a00-8000-0000000000aa" as View["id"],
      name: "Done",
      layout: "table",
      visible: ["Points", "Tags", "Notes", "Missing"],
      filter: { property: "Status", operator: "equals", value: "Done" },
      sorts: [{ property: "Points", direction: "descending" }],
    };
    expect(viewCsv(rows, view, schema, "Name")).toBe(
      "\uFEFFName,Points,Tags,Notes\r\n" +
        'Launch,3,"web, launch","A ""big"" one"\r\n' +
        "Old,,,\r\n",
    );
  });

  it("writes every row, by name, for a view without filters or properties", () => {
    const view: View = {
      id: "01929f4c-7b00-7a00-8000-0000000000ab" as View["id"],
      name: "All",
      layout: "board",
      visible: [],
      groupBy: "Status",
    };
    expect(viewCsv(rows, view, schema, "Nom")).toBe("\uFEFFNom\r\nLaunch\r\nOld\r\nSite\r\n");
  });
});
