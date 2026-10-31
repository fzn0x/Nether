// @vitest-environment jsdom
// A synced block's editor holds its one block: Enter in the block's own
// line breaks it, and nothing makes a second block.
import type { BlockId } from "@nether/core";
import { type Content, Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { OneBlock, rootBlocks } from "../src/NoteEmbed.tsx";
import { netherExtensions } from "../src/schema.ts";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(content: Content): Editor {
  let next = 0;
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...netherExtensions({ newId: () => `n${String(next++)}` as BlockId }), OneBlock],
    content,
  });
  editors.push(editor);
  return editor;
}

function press(editor: Editor, key: string): void {
  const event = new KeyboardEvent("keydown", { key });
  editor.view.someProp("handleKeyDown", (handle) => handle(editor.view, event));
}

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });
const item = (...content: object[]) => ({ type: "listItem", content });

describe("a synced block's editor", () => {
  it("breaks the block's line on Enter, rather than making a second block", () => {
    const editor = editorWith({ type: "doc", content: [paragraph("Shared")] });
    editor.commands.setTextSelection(4);
    press(editor, "Enter");
    expect(rootBlocks(editor.state.doc)).toBe(1);
    const inlines: string[] = [];
    editor.state.doc.firstChild?.forEach((inline) => inlines.push(inline.type.name));
    expect(inlines).toEqual(["text", "hardBreak", "text"]);
  });

  it("does not take a second block, as a paste of two paragraphs would make", () => {
    const editor = editorWith({ type: "doc", content: [paragraph("Shared")] });
    editor.commands.setTextSelection(7);
    editor.commands.insertContent([paragraph("One"), paragraph("Two")]);
    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.state.doc.textContent).toBe("Shared");
  });

  it("keeps a list item one item, while the items below it can grow", () => {
    const nested = {
      type: "bulletList",
      content: [item(paragraph("Child"))],
    };
    const editor = editorWith({
      type: "doc",
      content: [{ type: "bulletList", content: [item(paragraph("Parent"), nested)] }],
    });
    // In the item's own line: a line break.
    editor.commands.setTextSelection(5);
    press(editor, "Enter");
    expect(rootBlocks(editor.state.doc)).toBe(1);
    // In an item below it: a new item there.
    let end = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "Child") end = pos + node.nodeSize;
    });
    editor.commands.setTextSelection(end);
    press(editor, "Enter");
    expect(rootBlocks(editor.state.doc)).toBe(1);
    let items = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "listItem") items++;
    });
    expect(items).toBe(3);
  });

  it("leaves Enter in code to the code block", () => {
    const editor = editorWith({
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: "ts" }, content: [text("a")] }],
    });
    editor.commands.setTextSelection(2);
    press(editor, "Enter");
    expect(editor.state.doc.textContent).toBe("a\n");
  });
});
