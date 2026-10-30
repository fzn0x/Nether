import { describe, expect, it } from "vitest";
import {
  type BlockId,
  ModelError,
  type Note,
  createNote,
  isTimestamp,
  isUuid,
  noteFromJson,
  parseNote,
  serializeNote,
  walkBlocks,
} from "../src/index.ts";
import { at, databaseNote, edit, ids, richNote } from "./fixtures.ts";

type Json = Record<string, unknown>;
const content = (note: Json) => note.content as Json[];
const block = (note: Json, index: number) => at(content(note), index);

function rejects(note: unknown, message: string): void {
  expect(() => noteFromJson(note)).toThrow(message);
}

describe("the JSON form of a note", () => {
  it("reads every block and inline type and writes them back unchanged", () => {
    const note = noteFromJson(richNote());
    expect(parseNote(serializeNote(note))).toEqual(note);
    expect(note).toEqual(richNote());
  });

  it("keeps a database's schema and views", () => {
    const note = noteFromJson(databaseNote());
    expect(parseNote(serializeNote(note))).toEqual(note);
    expect(note.database?.views.map((view) => view.layout)).toEqual([
      "table",
      "board",
      "calendar",
      "timeline",
      "gallery",
      "list",
    ]);
  });

  it("writes fields in one order, whatever order they came in", () => {
    const shuffled = Object.fromEntries(Object.entries(richNote()).reverse()) as unknown as Note;
    expect(serializeNote(shuffled)).toBe(serializeNote(noteFromJson(richNote())));
    const written = JSON.parse(serializeNote(shuffled)) as Json;
    expect(Object.keys(written)).toEqual(["format", "version", "note"]);
    expect(Object.keys(written.note as Json)).toEqual([
      "id",
      "title",
      "properties",
      "content",
      "parent",
      "created",
      "updated",
    ]);
  });

  it("returns a copy, so later changes to the input do not reach the note", () => {
    const input = richNote();
    const note = noteFromJson(input);
    (block(input, 0).content as Json[]).push({ type: "hardBreak" });
    expect(note.content[0]).toEqual(block(richNote(), 0));
  });

  it("keeps a __proto__ key in plugin attributes as data", () => {
    const text = serializeNote(noteFromJson(richNote())).replace(
      '"lanes": 3',
      '"__proto__": { "polluted": true }',
    );
    const note = parseNote(text);
    const plugin = note.content.find((item) => item.type === "kanban-plugin/board");
    expect(Object.keys((plugin as unknown as { attrs: object }).attrs)).toContain("__proto__");
    expect(({} as Json).polluted).toBeUndefined();
  });

  it("reports the path of what is wrong as a ModelError", () => {
    const broken = edit(richNote(), (note) => {
      at(block(note, 2).children as Json[], 0).id = "h1";
    });
    try {
      noteFromJson(broken);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError);
      expect((error as ModelError).path).toBe("note.content[2].children[0].id");
      expect((error as ModelError).message).toBe(
        'note.content[2].children[0].id repeats the block ID "h1"',
      );
    }
  });
});

describe("parseNote", () => {
  const valid = serializeNote(noteFromJson(richNote()));

  it("rejects text that is not JSON", () => {
    expect(() => parseNote("{")).toThrow("$ is not JSON");
  });

  it("rejects other formats and newer versions", () => {
    expect(() => parseNote(valid.replace('"nether.note"', '"nether.workspace"'))).toThrow(
      '$.format must be one of "nether.note"',
    );
    expect(() => parseNote(valid.replace('"version": 1', '"version": 2'))).toThrow(
      "$.version is 2, newer than this version of Nether reads (1)",
    );
    expect(() => parseNote(valid.replace('"version": 1', '"version": 0'))).toThrow(
      "$.version must be a whole number",
    );
    expect(() => parseNote('{"format": "nether.note", "version": 1}')).toThrow("$.note is missing");
  });
});

describe("a note's fields", () => {
  it.each([
    [edit(richNote(), (note) => (note.extra = 1)), "note.extra is not a known field"],
    [edit(richNote(), (note) => delete note.title), "note.title is missing"],
    [edit(richNote(), (note) => (note.id = "Weekly review")), "note.id must be a note ID"],
    [edit(richNote(), (note) => (note.id = ids.note.toUpperCase())), "note.id must be a note ID"],
    [
      edit(richNote(), (note) => (note.parent = ids.note)),
      "note.parent must not be the note itself",
    ],
    [edit(richNote(), (note) => (note.title = "Two\nlines")), "note.title must be a single line"],
    [
      edit(richNote(), (note) => (note.created = "2026-10-30")),
      "note.created must be a UTC timestamp",
    ],
    [
      edit(richNote(), (note) => (note.trashed = "yesterday")),
      "note.trashed must be a UTC timestamp",
    ],
    [edit(richNote(), (note) => (note.content = {})), "note.content must be an array"],
    [[], "note must be an object"],
  ])("rejects a broken note (%#)", (note, message) => {
    rejects(note, message);
  });

  it("allows an empty title and a trashed date", () => {
    const note = noteFromJson(
      edit(richNote(), (copy) => {
        copy.title = "";
        copy.trashed = "2026-10-31T00:00:00Z";
      }),
    );
    expect(note.title).toBe("");
    expect(note.trashed).toBe("2026-10-31T00:00:00Z");
  });
});

describe("blocks", () => {
  const withBlock = (value: Json) => edit(richNote(), (note) => (note.content = [value]));
  const paragraph = (inline: unknown) =>
    withBlock({ id: "x", type: "paragraph", content: [inline] });

  it.each([
    [{ id: "x", type: "foo" }, "note.content[0].type is not a block type"],
    [{ id: "x", type: "Kanban/Board" }, "note.content[0].type is not a block type"],
    [{ id: "x y", type: "paragraph", content: [] }, "note.content[0].id must be a block ID"],
    [
      { id: "x", type: "paragraph", content: [], children: [] },
      "note.content[0].children is not a field of paragraph",
    ],
    [
      { id: "x", type: "paragraph", content: [], text: "" },
      "note.content[0].text is not a field of paragraph",
    ],
    [
      { id: "x", type: "heading", attrs: { level: 7 }, content: [] },
      "note.content[0].attrs.level must be a whole number from 1 to 6",
    ],
    [{ id: "x", type: "heading", content: [] }, "note.content[0].attrs must be an object"],
    [
      { id: "x", type: "numberedListItem", attrs: { start: -1 }, content: [] },
      "note.content[0].attrs.start must be a whole number",
    ],
    [
      { id: "x", type: "taskListItem", attrs: { checked: "yes" }, content: [] },
      "note.content[0].attrs.checked must be true or false",
    ],
    [
      { id: "x", type: "callout", attrs: { kind: "Note!" }, content: [] },
      "note.content[0].attrs.kind must be lowercase",
    ],
    [
      { id: "x", type: "callout", attrs: { kind: "note", fold: "half" }, content: [] },
      "note.content[0].attrs.fold must be one of",
    ],
    [{ id: "x", type: "code", text: "" }, "note.content[0].attrs must be an object"],
    [
      { id: "x", type: "code", attrs: { language: "ts" }, text: 1 },
      "note.content[0].text must be a string",
    ],
    [
      { id: "x", type: "divider", content: [] },
      "note.content[0].content is not a field of divider",
    ],
    [
      { id: "x", type: "tableRow", children: [] },
      "note.content[0].type tableRow cannot stand in a note or a container block",
    ],
    [
      { id: "x", type: "tableCell", content: [] },
      "note.content[0].type tableCell cannot stand in a note or a container block",
    ],
    [
      { id: "x", type: "column", children: [] },
      "note.content[0].type column cannot stand in a note or a container block",
    ],
    [
      { id: "x", type: "table", attrs: { header: false, align: [] }, children: [] },
      "note.content[0].attrs.align needs at least one column",
    ],
    [
      { id: "x", type: "table", attrs: { header: false, align: ["middle"] }, children: [] },
      "note.content[0].attrs.align[0] must be one of",
    ],
    [
      {
        id: "x",
        type: "table",
        attrs: { header: false, align: [null] },
        children: [{ id: "p", type: "paragraph", content: [] }],
      },
      "note.content[0].children[0].type paragraph cannot stand in a table",
    ],
    [
      {
        id: "x",
        type: "table",
        attrs: { header: false, align: [null, null] },
        children: [
          { id: "r", type: "tableRow", children: [{ id: "c", type: "tableCell", content: [] }] },
        ],
      },
      "note.content[0].children[0] has 1 cells, but the table has 2 columns",
    ],
    [
      {
        id: "x",
        type: "table",
        attrs: { header: false, align: [null] },
        children: [{ id: "r", type: "tableRow", children: [{ id: "p", type: "my-plugin/cell" }] }],
      },
      "note.content[0].children[0].children[0].type cannot stand in a table row",
    ],
    [
      { id: "x", type: "columns", children: [{ id: "a", type: "column", children: [] }] },
      "note.content[0].children needs at least two columns",
    ],
    [
      {
        id: "x",
        type: "columns",
        children: [
          { id: "a", type: "column", attrs: { width: 0 }, children: [] },
          { id: "b", type: "column", children: [] },
        ],
      },
      "note.content[0].children[0].attrs.width must be more than 0 and at most 1",
    ],
    [
      { id: "x", type: "image", attrs: { src: "a.png", width: 0 } },
      "note.content[0].attrs.width must be a whole number",
    ],
    [{ id: "x", type: "image", attrs: {} }, "note.content[0].attrs.src is missing"],
    [
      { id: "x", type: "bookmark", attrs: { url: "ftp://example.com" } },
      "note.content[0].attrs.url must be an http or https URL",
    ],
    [
      { id: "x", type: "embed", attrs: { target: {} } },
      "note.content[0].attrs.target needs a note, a title, or a heading or block of this note",
    ],
    [
      { id: "x", type: "embed", attrs: { target: { title: "A" }, alias: "" } },
      "note.content[0].attrs.alias must not be empty",
    ],
    [
      { id: "x", type: "database", attrs: { database: "Projects" } },
      "note.content[0].attrs.database must be a note ID",
    ],
    [{ id: "x", type: "raw", text: ["a"] }, "note.content[0].text must be a string"],
    [
      { id: "x", type: "my-plugin/board", text: "a" },
      "note.content[0].text is not a field of plugin blocks",
    ],
    [
      { id: "x", type: "my-plugin/board", attrs: [] },
      "note.content[0].attrs must be a JSON object",
    ],
  ])("rejects %j", (value, message) => {
    rejects(withBlock(value), message);
  });

  it("rejects a block ID used twice anywhere in the tree", () => {
    rejects(
      withBlock({
        id: "x",
        type: "quote",
        children: [{ id: "x", type: "paragraph", content: [] }],
      }),
      'note.content[0].children[0].id repeats the block ID "x"',
    );
  });

  it("gives a quote and a column without children an empty list, and code without text an empty string", () => {
    const note = noteFromJson(
      edit(richNote(), (copy) => {
        copy.content = [
          { id: "q", type: "quote" },
          { id: "k", type: "code", attrs: { language: "" } },
        ];
      }),
    );
    expect(note.content).toEqual([
      { id: "q", type: "quote", children: [] },
      { id: "k", type: "code", attrs: { language: "" }, text: "" },
    ]);
  });

  it.each([
    [{ type: "text", text: "" }, "note.content[0].content[0].text must not be empty"],
    [
      { type: "text", text: "a", marks: [{ type: "bold" }, { type: "bold" }] },
      "note.content[0].content[0].marks[1] repeats bold",
    ],
    [
      { type: "text", text: "a", marks: [{ type: "glow" }] },
      "note.content[0].content[0].marks[0].type must be one of",
    ],
    [
      { type: "text", text: "a", marks: [{ type: "link" }] },
      "note.content[0].content[0].marks[0].href is missing",
    ],
    [
      { type: "text", text: "a", marks: [{ type: "bold", href: "x" }] },
      "note.content[0].content[0].marks[0] has a link's fields but is not a link",
    ],
    [
      { type: "text", text: "a", name: "b" },
      "note.content[0].content[0].name is not a field of text",
    ],
    [
      { type: "hardBreak", text: "a" },
      "note.content[0].content[0].text is not a field of hardBreak",
    ],
    [
      { type: "wikiLink", target: { note: ids.other, title: "Both" } },
      "note.content[0].content[0].target has both a note and a title: give one",
    ],
    [
      { type: "wikiLink", target: { title: "A", heading: "B", block: "c" } },
      "note.content[0].content[0].target can point at a heading or a block, not both",
    ],
    [
      { type: "wikiLink", target: { title: "A" }, alias: "" },
      "note.content[0].content[0].alias must not be empty",
    ],
    [{ type: "tag", name: "2026" }, "note.content[0].content[0].name must be a tag name"],
    [{ type: "tag", name: "a//b" }, "note.content[0].content[0].name must be a tag name"],
    [{ type: "tag", name: "#tag" }, "note.content[0].content[0].name must be a tag name"],
    [{ type: "math", latex: " " }, "note.content[0].content[0].latex must not be empty"],
    [
      { type: "tag", name: "a", marks: [{ type: "bold" }, { type: "bold" }] },
      "note.content[0].content[0].marks[1] repeats bold",
    ],
    [
      { type: "hardBreak", marks: [] },
      "note.content[0].content[0].marks is not a field of hardBreak",
    ],
    [{ type: "mention", person: "x" }, "note.content[0].content[0].type must be one of"],
  ])("rejects inline %j", (inline, message) => {
    rejects(paragraph(inline), message);
  });
});

describe("createNote", () => {
  it("gives a new note a time-ordered ID and the same created and updated time", () => {
    const note = createNote({ title: "Inbox" }, "2026-10-30T10:00:00.000Z");
    expect(isUuid(note.id)).toBe(true);
    expect(note.id[14]).toBe("7");
    expect(note).toMatchObject({
      title: "Inbox",
      properties: [],
      content: [],
      created: "2026-10-30T10:00:00.000Z",
      updated: "2026-10-30T10:00:00.000Z",
    });
  });

  it("stamps the current time by default and checks what it is given", () => {
    const parent = noteFromJson(databaseNote());
    const row = createNote({
      title: "Ship the editor",
      parent: parent.id,
      properties: [{ key: "status", value: "Planned" }],
      content: [{ id: "a" as BlockId, type: "paragraph", content: [] }],
    });
    expect(isTimestamp(row.created)).toBe(true);
    expect(row.parent).toBe(parent.id);
    expect(() => createNote({ title: "x", content: [{ id: "a", type: "nope" } as never] })).toThrow(
      "note.content[0].type is not a block type",
    );
  });

  it("can make a note that is a database", () => {
    const schema = noteFromJson(databaseNote()).database;
    if (schema === undefined) throw new Error("the fixture is a database");
    expect(createNote({ title: "Copy", database: schema }).database).toEqual(schema);
  });
});

describe("walkBlocks", () => {
  it("visits every block, parents before children", () => {
    const ids = [...walkBlocks(noteFromJson(richNote()).content)].map((item) => item.id);
    expect(ids.slice(0, 4)).toEqual(["h1", "p1", "b1", "b2"]);
    expect(ids).toContain("cell-4");
    expect(ids).toContain("col1p");
    expect(ids).toContain("plug-p");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
