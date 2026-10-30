// @vitest-environment jsdom
// The editor in a browser document: what it renders as HTML, as when a note
// is copied, reads back as the same blocks, and its IDs behave.
import type { BlockId, ContentBlock } from "@nether/core";
import { type Content, Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { fromEditor, netherExtensions, toEditor } from "../src/index.ts";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(content: Content): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: netherExtensions(),
    content,
  });
  editors.push(editor);
  return editor;
}

/** The type of the first node of the editor's document. */
function firstType(editor: Editor): string | undefined {
  return editor.getJSON().content[0]?.type;
}

function newIds(): () => BlockId {
  let next = 0;
  return () => `new${String(next++)}` as BlockId;
}

const text = (value: string) => ({ type: "text" as const, text: value });
const id = (value: string) => value as BlockId;

const note: ContentBlock[] = [
  { id: id("h"), type: "heading", attrs: { level: 2 }, content: [text("Title")] },
  {
    id: id("p"),
    type: "paragraph",
    content: [
      text("a "),
      {
        type: "text",
        text: "b",
        marks: [{ type: "bold" }, { type: "code" }, { type: "link", href: "https://x.com" }],
      },
      text(" "),
      { type: "text", text: "c", marks: [{ type: "highlight" }, { type: "comment" }] },
      text(" "),
      { type: "wikiLink", target: { title: "Note", heading: "Part" }, alias: "the part" },
      text(" "),
      { type: "tag", name: "area/x" },
      text(" "),
      { type: "math", latex: "x^2" },
      text(" "),
      { type: "raw", markdown: "<kbd>K</kbd>" },
    ],
  },
  {
    // Markdown's soft breaks, new lines in text, apart from its hard breaks.
    id: id("soft"),
    type: "paragraph",
    content: [
      text("first line\nsecond "),
      { type: "text", text: "bold\nline", marks: [{ type: "bold" }] },
      { type: "hardBreak" },
      text("after a hard break"),
    ],
  },
  {
    id: id("list"),
    type: "taskListItem",
    attrs: { checked: true },
    content: [text("done")],
    children: [{ id: id("sub"), type: "bulletListItem", content: [text("nested")] }],
  },
  { id: id("n"), type: "numberedListItem", attrs: { start: 4 }, content: [text("four")] },
  {
    id: id("q"),
    type: "quote",
    children: [{ id: id("q1"), type: "paragraph", content: [text("quoted")] }],
  },
  {
    id: id("c"),
    type: "callout",
    attrs: { kind: "warning", fold: "open" },
    content: [text("Careful")],
    children: [{ id: id("c1"), type: "paragraph", content: [text("body")] }],
  },
  {
    id: id("t"),
    type: "toggle",
    content: [text("More")],
    children: [{ id: id("t1"), type: "paragraph", content: [text("inside")] }],
  },
  { id: id("k"), type: "code", attrs: { language: "ts" }, text: "let a = 1;" },
  { id: id("m"), type: "math", text: "\\frac{1}{2}" },
  { id: id("d"), type: "divider" },
  {
    id: id("tbl"),
    type: "table",
    attrs: { header: true, align: ["left", "right"] },
    children: [
      {
        id: id("r1"),
        type: "tableRow",
        children: [
          { id: id("a1"), type: "tableCell", content: [text("A")] },
          { id: id("a2"), type: "tableCell", content: [text("B")] },
        ],
      },
      {
        id: id("r2"),
        type: "tableRow",
        children: [
          { id: id("b1"), type: "tableCell", content: [text("1")] },
          { id: id("b2"), type: "tableCell", content: [] },
        ],
      },
    ],
  },
  {
    id: id("cols"),
    type: "columns",
    children: [
      {
        id: id("col1"),
        type: "column",
        attrs: { width: 0.4 },
        children: [{ id: id("x"), type: "paragraph", content: [text("left")] }],
      },
      {
        id: id("col2"),
        type: "column",
        children: [{ id: id("y"), type: "paragraph", content: [text("right")] }],
      },
    ],
  },
  { id: id("img"), type: "image", attrs: { src: "a.png", alt: "A", title: "T", width: 320 } },
  { id: id("f"), type: "file", attrs: { src: "spec.pdf", name: "Spec" } },
  { id: id("bk"), type: "bookmark", attrs: { url: "https://example.com" } },
  { id: id("em"), type: "embed", attrs: { target: { title: "photo.png" }, alias: "300" } },
  {
    id: id("db"),
    type: "database",
    attrs: { database: "01929f4c-7b00-7a00-8000-000000000001" as never },
  },
  { id: id("raw"), type: "raw", text: "<div>\nhi\n</div>" },
  { id: id("pl"), type: "kanban/board", attrs: { lanes: 2 } },
];

describe("the editor in a document", () => {
  it("keeps every block and its ID", () => {
    const editor = editorWith(toEditor(note));
    expect(fromEditor(editor.getJSON(), newIds())).toEqual(note);
  });

  it("reads its own HTML back as the same blocks, as a copy and paste does", () => {
    const html = editorWith(toEditor(note)).getHTML();
    const pasted = editorWith(html);
    expect(fromEditor(pasted.getJSON(), newIds())).toEqual(note);
  });

  it("gives new blocks new IDs and a pasted copy of a block an ID of its own", () => {
    let next = 0;
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: netherExtensions({ newId: () => `gen${String(next++)}` as BlockId }),
      content: toEditor([{ id: id("p"), type: "paragraph", content: [text("one")] }]),
    });
    editors.push(editor);
    editor.commands.insertContentAt(editor.state.doc.content.size, "<p>two</p><p>three</p>");
    const blocks = fromEditor(editor.getJSON(), newIds());
    expect(blocks.map((block) => block.id)).toEqual(["p", "gen0", "gen1"]);
    // The same block pasted again gets a fresh ID: IDs stay unique in a note.
    editor.commands.insertContentAt(editor.state.doc.content.size, editor.getHTML());
    const ids = fromEditor(editor.getJSON(), newIds()).map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("turns Markdown typed at the start of a line into blocks", () => {
    const editor = editorWith({ type: "doc", content: [{ type: "paragraph" }] });
    const typed = (value: string) => {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (handle) =>
        handle(editor.view, from, to, value, () => editor.state.tr.insertText(value, from, to)),
      );
      if (handled !== true) editor.view.dispatch(editor.state.tr.insertText(value, from, to));
    };
    const type = (value: string) => {
      for (const char of value) typed(char);
    };
    type("## ");
    expect(firstType(editor)).toBe("heading");
    expect(editor.getJSON()).toMatchObject({ content: [{ attrs: { level: 2 } }] });
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    type("- ");
    expect(firstType(editor)).toBe("bulletList");
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    type("> ");
    expect(firstType(editor)).toBe("blockquote");
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    type("**bold** ");
    expect(fromEditor(editor.getJSON(), newIds())[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }, text(" ")],
    });
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    type("==mark== ");
    expect(fromEditor(editor.getJSON(), newIds())[0]).toMatchObject({
      content: [{ type: "text", text: "mark", marks: [{ type: "highlight" }] }, text(" ")],
    });
  });

  it("keeps a block's ID with its text when Enter splits it at the start", () => {
    const editor = editorWith(
      toEditor([{ id: id("keep"), type: "paragraph", content: [text("words")] }]),
    );
    editor.commands.setTextSelection(1);
    editor.commands.splitBlock();
    const blocks = fromEditor(editor.getJSON(), newIds());
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ id: "keep", content: [text("words")] });
    expect(blocks[0]?.id).not.toBe("keep");
  });

  it("reads what other apps paste, with missing or broken attributes", () => {
    const editor = editorWith(
      [
        '<div data-type="embed" data-target="{not json">x</div>',
        '<div data-columns><div data-column data-width="0.3"><p>a</p></div><div data-column><p>b</p></div></div>',
        '<div data-type="pluginBlock"></div>',
        '<p><span data-type="wikiLink" data-target="{&quot;note&quot;:&quot;01929f4c-7b00-7a00-8000-000000000001&quot;,&quot;block&quot;:&quot;b1&quot;}">x</span></p>',
      ].join(""),
    );
    const blocks = fromEditor(editor.getJSON(), newIds());
    expect(blocks.map((block) => block.type)).toEqual(["columns", "", "paragraph"]);
    expect(blocks[0]).toMatchObject({
      children: [{ attrs: { width: 0.3 } }, { type: "column" }],
    });
    expect(blocks[2]).toMatchObject({
      content: [
        { type: "wikiLink", target: { note: "01929f4c-7b00-7a00-8000-000000000001", block: "b1" } },
      ],
    });
    // The chip shows a link's alias, or else where it points.
    expect(editor.getText()).toContain("01929f4c-7b00-7a00-8000-000000000001#^b1");
  });
});
