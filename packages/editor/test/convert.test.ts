import type { BlockId, ContentBlock } from "@nether/core";
import { readContent } from "@nether/core";
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { fromEditor, netherExtensions, toEditor } from "../src/index.ts";

const schema = getSchema(netherExtensions());

function newIds(): () => BlockId {
  let next = 0;
  return () => `new${String(++next)}` as BlockId;
}

/** Blocks to the editor and back, checking the document against the schema on the way. */
function roundTrip(blocks: readonly ContentBlock[]): ContentBlock[] {
  const doc = toEditor(blocks);
  schema.nodeFromJSON(doc).check();
  return fromEditor(doc, newIds());
}

const text = (value: string) => ({ type: "text" as const, text: value });
const id = (value: string) => value as BlockId;

describe("toEditor and fromEditor", () => {
  it("keep paragraphs, headings and marks", () => {
    const blocks: ContentBlock[] = [
      {
        id: id("p"),
        type: "paragraph",
        content: [
          text("plain "),
          {
            type: "text",
            text: "bold link",
            marks: [{ type: "bold" }, { type: "link", href: "https://x.com", title: "X" }],
          },
          { type: "hardBreak" },
          {
            type: "wikiLink",
            target: { title: "Note", heading: "Part" },
            alias: "the part",
            marks: [{ type: "italic" }],
          },
          { type: "tag", name: "area/research" },
          { type: "math", latex: "x^2" },
          { type: "raw", markdown: "<kbd>K</kbd>" },
          { type: "text", text: "hidden", marks: [{ type: "comment" }] },
        ],
      },
      { id: id("h"), type: "heading", attrs: { level: 3 }, content: [text("Title")] },
      { id: id("e"), type: "heading", attrs: { level: 1 }, content: [] },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("gather list items into lists and split them back, nested items and all", () => {
    const blocks: ContentBlock[] = [
      {
        id: id("a"),
        type: "bulletListItem",
        content: [text("a")],
        children: [
          { id: id("b"), type: "numberedListItem", attrs: { start: 3 }, content: [text("b")] },
          { id: id("c"), type: "numberedListItem", content: [text("c")] },
        ],
      },
      { id: id("d"), type: "taskListItem", attrs: { checked: true }, content: [text("d")] },
      { id: id("e"), type: "taskListItem", attrs: { checked: false }, content: [] },
      { id: id("f"), type: "numberedListItem", content: [text("f")] },
      { id: id("g"), type: "numberedListItem", attrs: { start: 7 }, content: [text("g")] },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
    const doc = toEditor(blocks);
    expect(doc.content?.map((node) => node.type)).toEqual([
      "bulletList",
      "taskList",
      "orderedList",
      "orderedList",
    ]);
  });

  it("keep quotes, callouts, toggles, code, math, dividers and columns", () => {
    const blocks: ContentBlock[] = [
      {
        id: id("q"),
        type: "quote",
        children: [{ id: id("q1"), type: "paragraph", content: [text("quoted")] }],
      },
      {
        id: id("c"),
        type: "callout",
        attrs: { kind: "warning", fold: "closed" },
        content: [text("Careful")],
        children: [{ id: id("c1"), type: "paragraph", content: [text("body")] }],
      },
      { id: id("c2"), type: "callout", attrs: { kind: "tip" }, content: [] },
      {
        id: id("t"),
        type: "toggle",
        content: [text("More")],
        children: [{ id: id("t1"), type: "divider" }],
      },
      { id: id("t2"), type: "toggle", content: [] },
      { id: id("k"), type: "code", attrs: { language: "ts" }, text: "let a = 1;\nlet b = 2;" },
      { id: id("k2"), type: "code", attrs: { language: "" }, text: "" },
      { id: id("m"), type: "math", text: "\\frac{1}{2}" },
      {
        id: id("cols"),
        type: "columns",
        children: [
          {
            id: id("col1"),
            type: "column",
            attrs: { width: 0.6 },
            children: [{ id: id("x"), type: "paragraph", content: [text("left")] }],
          },
          { id: id("col2"), type: "column", children: [] },
        ],
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("keep tables, with their header, alignment and cells", () => {
    const blocks: ContentBlock[] = [
      {
        id: id("tbl"),
        type: "table",
        attrs: { header: true, align: ["left", null] },
        children: [
          {
            id: id("r1"),
            type: "tableRow",
            children: [
              { id: id("a1"), type: "tableCell", content: [text("Name")] },
              { id: id("a2"), type: "tableCell", content: [] },
            ],
          },
          {
            id: id("r2"),
            type: "tableRow",
            children: [
              {
                id: id("b1"),
                type: "tableCell",
                content: [text("x"), { type: "hardBreak" }, text("y")],
              },
              { id: id("b2"), type: "tableCell", content: [{ type: "tag", name: "t" }] },
            ],
          },
        ],
      },
      {
        id: id("tbl2"),
        type: "table",
        attrs: { header: false, align: [null] },
        children: [
          {
            id: id("r3"),
            type: "tableRow",
            children: [{ id: id("c1"), type: "tableCell", content: [] }],
          },
        ],
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("keep images, files, bookmarks, embeds, databases, raw Markdown and plugin blocks", () => {
    const blocks: ContentBlock[] = [
      { id: id("i"), type: "image", attrs: { src: "a.png", alt: "A", title: "T", width: 300 } },
      { id: id("i2"), type: "image", attrs: { src: "b.png" } },
      { id: id("f"), type: "file", attrs: { src: "spec.pdf", name: "Spec" } },
      { id: id("bk"), type: "bookmark", attrs: { url: "https://example.com" } },
      { id: id("em"), type: "embed", attrs: { target: { title: "photo.png" }, alias: "300" } },
      { id: id("em2"), type: "embed", attrs: { target: { block: id("x1") } } },
      {
        id: id("db"),
        type: "database",
        attrs: { database: "01929f4c-7b00-7a00-8000-000000000001" as never },
      },
      { id: id("raw"), type: "raw", text: "<div>\nhi\n</div>" },
      { id: id("pl"), type: "kanban/board", attrs: { lanes: 2 } },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it("give blocks the editor made without an ID a new one", () => {
    const blocks = fromEditor(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
      newIds(),
    );
    expect(blocks).toEqual([{ id: "new1", type: "paragraph", content: [text("a")] }]);
  });

  it("turn what Markdown cannot hold into what it can", () => {
    const blocks = fromEditor(
      {
        type: "doc",
        content: [
          // A single column is no longer columns.
          {
            type: "columns",
            attrs: { id: "c" },
            content: [{ type: "column", content: [{ type: "paragraph" }] }],
          },
          // Paragraphs in a table cell become one line with breaks.
          {
            type: "table",
            attrs: { id: "t", align: ["right", "sideways"] },
            content: [
              {
                type: "tableRow",
                attrs: { id: "r" },
                content: [
                  {
                    type: "tableCell",
                    attrs: { id: "x" },
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: "a" }] },
                      { type: "paragraph", content: [{ type: "text", text: "b" }] },
                    ],
                  },
                ],
              },
            ],
          },
          // A link without an address keeps its text.
          {
            type: "paragraph",
            attrs: { id: "p" },
            content: [
              {
                type: "text",
                text: "x",
                marks: [{ type: "link", attrs: { href: "" } }, { type: "unknown" }],
              },
            ],
          },
          { type: "embed", attrs: { id: "e", target: null } },
          { type: "somethingElse" },
        ],
      },
      newIds(),
    );
    expect(blocks).toEqual([
      {
        id: "t",
        type: "table",
        attrs: { header: false, align: ["right"] },
        children: [
          {
            id: "r",
            type: "tableRow",
            children: [
              {
                id: "x",
                type: "tableCell",
                content: [text("a"), { type: "hardBreak" }, text("b")],
              },
            ],
          },
        ],
      },
      { id: "p", type: "paragraph", content: [text("x")] },
    ]);
    expect(() => readContent(blocks, "content")).not.toThrow();
  });

  it("start an empty note with one empty paragraph", () => {
    expect(toEditor([])).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(fromEditor({ type: "doc" }, newIds())).toEqual([]);
  });

  it("write a toggle's summary as text, as Markdown keeps it", () => {
    const doc = toEditor([
      {
        id: id("t"),
        type: "toggle",
        content: [
          text("See "),
          { type: "wikiLink", target: { title: "Plan", heading: "Now" } },
          { type: "hardBreak" },
          {
            type: "wikiLink",
            target: { note: "01929f4c-7b00-7a00-8000-000000000001" as never, block: id("b1") },
            alias: "it",
          },
          text(" "),
          { type: "tag", name: "x", marks: [{ type: "bold" }] },
          { type: "math", latex: "y" },
          { type: "raw", markdown: "<b>" },
          { type: "wikiLink", target: { block: id("b2") } },
        ],
      },
    ]);
    schema.nodeFromJSON(doc).check();
    expect(fromEditor(doc, newIds())[0]).toMatchObject({
      content: [
        text("See Plan#Now it "),
        { type: "text", text: "#x", marks: [{ type: "bold" }] },
        text("y<b>#^b2"),
      ],
    });
  });
});
