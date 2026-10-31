// Importing: a folder of Markdown brought over byte for byte with its
// files, and a CSV table as a database of notes.
import { describe, expect, it } from "vitest";
import {
  type ImportSource,
  freeNames,
  parseCsv,
  parseMarkdown,
  planCsv,
  planFolder,
  safeName,
} from "../src/index.ts";

function source(name: string, files: Readonly<Record<string, string>>): ImportSource {
  return {
    name,
    files: Object.keys(files).map((path) => ({ path, size: files[path]?.length ?? 0 })),
    readText: (path) => Promise.resolve(files[path] ?? ""),
  };
}

describe("planFolder", () => {
  it("brings each note over byte for byte, and its files beside it, under the folder it goes in", async () => {
    const plan = await planFolder(
      source("Vault", {
        "Home.md": "---\ntags: [start]\n---\n# Home\r\nSee [[Plan]] and ![[photo.png]]\n",
        "Projects/Plan.markdown": "Plan",
        "photo.png": "PNG",
        "Board.canvas": "{}",
      }),
      "Vault",
    );
    expect(plan.notes).toEqual([
      {
        path: "Vault/Home.md",
        text: "---\ntags: [start]\n---\n# Home\r\nSee [[Plan]] and ![[photo.png]]\n",
      },
      { path: "Vault/Projects/Plan.md", text: "Plan" },
    ]);
    expect(plan.files).toEqual([
      { from: "photo.png", to: "Vault/photo.png" },
      { from: "Board.canvas", to: "Vault/Board.canvas" },
    ]);
    expect(plan.warnings).toEqual([]);
    // At the vault's top.
    expect((await planFolder(source("x", { "a.md": "A" }), "")).notes).toEqual([
      { path: "a.md", text: "A" },
    ]);
  });
});

describe("parseCsv", () => {
  it("reads quoted cells, doubled quotes and any line ending, after a byte order mark", () => {
    expect(parseCsv('\uFEFFName,Note\r\n"Launch, now","A ""big""\none"\nSite,\r')).toEqual([
      ["Name", "Note"],
      ["Launch, now", 'A "big"\none'],
      ["Site", ""],
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  });
});

describe("planCsv", () => {
  const csv = [
    "Name,Points,Due,Done,Link,Note",
    "Launch,3,2026-11-15,Yes,https://example.com,007",
    "Site,10,2026-11-20,no,,A note",
    "Launch,,,,,,",
    "Plan: v2/next,1.5,,true,,,extra",
    ",,,,,,",
  ].join("\n");
  const plan = planCsv("Projects", csv, "Imported");

  it("makes a database whose properties are the columns, each typed as all its values read", () => {
    const database = plan.notes[0];
    expect(database?.path).toBe("Imported/Projects.md");
    expect(parseMarkdown(database?.text ?? "").properties).toEqual([
      {
        key: "database",
        value: {
          properties: [
            { key: "Points", type: "number" },
            { key: "Due", type: "date" },
            { key: "Done", type: "checkbox" },
            { key: "Link", type: "url" },
            { key: "Note", type: "text" },
            { key: "Column 7", type: "text" },
          ],
          views: [
            {
              name: "Table",
              layout: "table",
              visible: ["Points", "Due", "Done", "Link", "Note", "Column 7"],
            },
          ],
        },
      },
    ]);
    expect(plan.warnings).toEqual([
      "Projects: some lines have more cells than the header has columns; they are in Column 7.",
    ]);
  });

  it("makes a note for each line, named by its first cell, with its values as properties", () => {
    const rows = plan.notes.slice(1).map((note) => ({
      path: note.path,
      properties: parseMarkdown(note.text).properties,
    }));
    expect(rows).toEqual([
      {
        path: "Imported/Projects/Launch.md",
        properties: [
          { key: "Points", value: 3 },
          { key: "Due", value: "2026-11-15" },
          { key: "Done", value: true },
          { key: "Link", value: "https://example.com" },
          { key: "Note", value: "007" },
        ],
      },
      {
        path: "Imported/Projects/Site.md",
        properties: [
          { key: "Points", value: 10 },
          { key: "Due", value: "2026-11-20" },
          { key: "Done", value: false },
          { key: "Note", value: "A note" },
        ],
      },
      // The same name again, and one a file cannot hold, kept as an alias.
      { path: "Imported/Projects/Launch 2.md", properties: [] },
      {
        path: "Imported/Projects/Plan v2 next.md",
        properties: [
          { key: "aliases", value: ["Plan: v2/next"] },
          { key: "Points", value: 1.5 },
          { key: "Done", value: true },
          { key: "Column 7", value: "extra" },
        ],
      },
    ]);
  });

  it("names a table with nothing in it, and keeps a header's names apart", () => {
    const empty = planCsv("  ", "", "");
    expect(empty.notes.map((note) => note.path)).toEqual(["Table.md"]);
    const twice = planCsv("T", "Name,Tag,Tag,\nA,x,y,z\n", "");
    expect(parseMarkdown(twice.notes[1]?.text ?? "").properties).toEqual([
      { key: "Tag", value: "x" },
      { key: "Tag 2", value: "y" },
      { key: "Column 4", value: "z" },
    ]);
  });
});

describe("names", () => {
  it("are what file systems take, and never the same twice", () => {
    expect(safeName(' a/b:c*?"<>| [[x]] #y ^z. ')).toBe("a b c x y z");
    expect(safeName("...")).toBe("Untitled");
    expect(safeName("tab\there\u0007")).toBe("tab here");
    expect(safeName("", "Table")).toBe("Table");
    const next = freeNames();
    expect([next("A"), next("a"), next("A 2"), next("B")]).toEqual(["A", "a 2", "A 2 2", "B"]);
  });
});
