// @vitest-environment jsdom
// Going to a heading or block of a note, and to a place in its text, as a
// link to a part of a note, or a template's cursor, asks.
import type { BlockId, ContentBlock } from "@nether/core";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { toEditor } from "../src/convert.ts";
import { findPart } from "../src/parts.ts";
import { netherExtensions } from "../src/schema.ts";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(blocks: readonly ContentBlock[]): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: netherExtensions({ newId: () => "new" as BlockId }),
    content: toEditor(blocks),
  });
  editors.push(editor);
  return editor;
}

const id = (text: string) => text as BlockId;

const blocks: readonly ContentBlock[] = [
  {
    id: id("h1"),
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: "Next  Steps" }],
  },
  {
    id: id("p1"),
    type: "paragraph",
    content: [
      { type: "text", text: "See " },
      { type: "wikiLink", target: { title: "A" } },
      { type: "text", text: " and bc." },
    ],
  },
  {
    id: id("t1"),
    type: "taskListItem",
    attrs: { checked: false },
    content: [],
    children: [{ id: id("t2"), type: "bulletListItem", content: [{ type: "text", text: "x" }] }],
  },
  { id: id("c1"), type: "code", attrs: { language: "js" }, text: "let x = ;" },
];

/** The text of the block the position is in, before and after it. */
function around(editor: Editor, position: number): [string, string] {
  const resolved = editor.state.doc.resolve(position);
  const parent = resolved.parent;
  const leaf = (node: { readonly type: { readonly name: string } }) =>
    node.type.name === "wikiLink" ? "[[A]]" : "";
  return [
    parent.textBetween(0, resolved.parentOffset, undefined, leaf),
    parent.textBetween(resolved.parentOffset, parent.content.size, undefined, leaf),
  ];
}

describe("findPart", () => {
  it("finds a heading by its text, case and spaces aside, at its start", () => {
    const editor = editorWith(blocks);
    const position = findPart(editor.state.doc, { heading: " next steps" });
    expect(position).toBeDefined();
    expect(around(editor, position ?? 0)).toEqual(["", "Next  Steps"]);
  });

  it("finds a place in a block's text, a link counting one", () => {
    const editor = editorWith(blocks);
    expect(around(editor, findPart(editor.state.doc, { block: "p1", offset: 11 }) ?? 0)).toEqual([
      "See [[A]] and b",
      "c.",
    ]);
    expect(around(editor, findPart(editor.state.doc, { block: "c1", offset: 8 }) ?? 0)).toEqual([
      "let x = ",
      ";",
    ]);
  });

  it("goes into the text of a list item, and no further than its end", () => {
    const editor = editorWith(blocks);
    const task = findPart(editor.state.doc, { block: "t1" }) ?? 0;
    expect(editor.state.doc.resolve(task).parent.type.name).toBe("paragraph");
    expect(editor.state.doc.resolve(task).node(-1).attrs.id).toBe("t1");
    expect(around(editor, findPart(editor.state.doc, { block: "t2", offset: 9 }) ?? 0)).toEqual([
      "x",
      "",
    ]);
  });

  it("finds nothing for a part the note does not have", () => {
    const editor = editorWith(blocks);
    expect(findPart(editor.state.doc, { block: "missing" })).toBeUndefined();
    expect(findPart(editor.state.doc, { heading: "Missing" })).toBeUndefined();
  });
});
