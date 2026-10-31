// @vitest-environment jsdom
// Inserting blocks from the slash menu's commands, and what the block menu
// and its shortcuts do to a whole block: move, duplicate, delete, turn into.
import type { BlockId } from "@nether/core";
import { type Content, Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import {
  BlockKeys,
  canTurn,
  currentBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  turnBlockInto,
} from "../src/actions.ts";
import { type BlockCommand, blockCommands, findCommands } from "../src/commands.ts";
import { fromEditor } from "../src/convert.ts";
import { codeLanguage, netherExtensions } from "../src/schema.ts";
import { englishWords } from "../src/words.ts";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(content: Content): Editor {
  let next = 0;
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...netherExtensions({ newId: () => `n${String(next++)}` as BlockId }), BlockKeys],
    content,
  });
  editors.push(editor);
  return editor;
}

const commands = blockCommands();
function command(id: string): BlockCommand {
  const found = commands.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no command ${id}`);
  return found;
}

const paragraph = (text: string, id?: string): JSONContent => ({
  type: "paragraph",
  attrs: { id: id ?? text },
  content: [{ type: "text", text }],
});

/**
 * Presses keys in the editor as the browser would. TipTap's keyboardShortcut
 * command keeps only the steps of what a shortcut does, not the selection.
 */
function press(editor: Editor, key: string, modifiers: KeyboardEventInit = {}): void {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, ...modifiers });
  editor.view.someProp("handleKeyDown", (handle) => handle(editor.view, event));
}

/** The text of each top-level block, with its type. */
function outline(editor: Editor): string[] {
  const lines: string[] = [];
  editor.state.doc.forEach((node) => {
    lines.push(`${node.type.name}:${node.textContent}`);
  });
  return lines;
}

/** The position of the top-level block with this text. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.forEach((node, offset) => {
    if (found === -1 && node.textContent === text) found = offset;
  });
  if (found === -1) throw new Error(`no block ${text}`);
  return found;
}

describe("finding commands", () => {
  it("lists every command when nothing is typed", () => {
    expect(findCommands("", commands)).toHaveLength(commands.length);
  });

  it("matches the starts of words in the title and keywords, in any order", () => {
    expect(findCommands("head", commands).map((item) => item.id)).toEqual([
      "heading1",
      "heading2",
      "heading3",
    ]);
    expect(findCommands("h2", commands).map((item) => item.id)).toEqual(["heading2"]);
    expect(findCommands("LIST num", commands).map((item) => item.id)).toEqual(["numberedList"]);
    expect(findCommands("latex", commands).map((item) => item.id)).toEqual(["math"]);
    expect(findCommands("mermaid", commands).map((item) => item.id)).toEqual(["diagram"]);
    expect(findCommands("ading", commands)).toEqual([]);
  });

  it("uses the words of the app's language", () => {
    const words = {
      ...englishWords,
      blocks: { ...englishWords.blocks, math: { title: "Formel", keywords: "gleichung" } },
    };
    const german = blockCommands(words);
    expect(findCommands("gleich", german).map((item) => item.title)).toEqual(["Formel"]);
  });
});

describe("inserting blocks", () => {
  const cases: [string, string][] = [
    ["text", "paragraph"],
    ["heading2", "heading"],
    ["bulletList", "bulletList"],
    ["numberedList", "orderedList"],
    ["taskList", "taskList"],
    ["quote", "blockquote"],
    ["callout", "callout"],
    ["toggle", "details"],
    ["code", "codeBlock"],
    ["math", "mathBlock"],
    ["diagram", "codeBlock"],
    ["query", "codeBlock"],
    ["divider", "horizontalRule"],
    ["table", "table"],
    ["columns", "columns"],
  ];

  it.each(cases)("%s makes a %s that the note keeps", (id, type) => {
    const editor = editorWith({ type: "doc", content: [{ type: "paragraph" }] });
    editor.commands.setTextSelection(1);
    command(id).run(editor);
    const types = editor.getJSON().content.map((node) => node.type);
    expect(types).toContain(type);
    // The new blocks convert to the core model, each with its own ID.
    const blocks = fromEditor(editor.getJSON(), () => "x" as BlockId);
    expect(blocks.length).toBeGreaterThan(0);
    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (typeof node.attrs.id === "string") ids.push(node.attrs.id);
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes a diagram a Mermaid code block", () => {
    const editor = editorWith({ type: "doc", content: [{ type: "paragraph" }] });
    editor.commands.setTextSelection(1);
    command("diagram").run(editor);
    const code = editor.getJSON().content.find((node) => node.type === "codeBlock");
    expect(code?.attrs?.language).toBe("mermaid");
  });

  it("makes a query a base code block", () => {
    const editor = editorWith({ type: "doc", content: [{ type: "paragraph" }] });
    editor.commands.setTextSelection(1);
    command("query").run(editor);
    const code = editor.getJSON().content.find((node) => node.type === "codeBlock");
    expect(code?.attrs?.language).toBe("base");
    expect(findCommands("dataview", commands).map((item) => item.id)).toEqual(["query"]);
  });
});

describe("moving blocks", () => {
  const three = { type: "doc", content: [paragraph("a"), paragraph("b"), paragraph("c")] };

  it("moves a block up and down, with the caret in it", () => {
    const editor = editorWith(three);
    editor.commands.setTextSelection(posOf(editor, "b") + 2);
    expect(moveBlock(editor, posOf(editor, "b"), -1)).toBe(true);
    expect(outline(editor)).toEqual(["paragraph:b", "paragraph:a", "paragraph:c"]);
    expect(editor.state.selection.from).toBe(posOf(editor, "b") + 2);
    expect(moveBlock(editor, posOf(editor, "b"), 1)).toBe(true);
    expect(moveBlock(editor, posOf(editor, "b"), 1)).toBe(true);
    expect(outline(editor)).toEqual(["paragraph:a", "paragraph:c", "paragraph:b"]);
    expect(editor.state.selection.from).toBe(posOf(editor, "b") + 2);
  });

  it("keeps a selected block selected", () => {
    const editor = editorWith(three);
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, posOf(editor, "c"))),
    );
    moveBlock(editor, posOf(editor, "c"), -1);
    const { selection } = editor.state;
    expect(selection instanceof NodeSelection && selection.node.textContent).toBe("c");
  });

  it("does nothing at either end, or past a callout's title", () => {
    const editor = editorWith(three);
    expect(moveBlock(editor, posOf(editor, "a"), -1)).toBe(false);
    expect(moveBlock(editor, posOf(editor, "c"), 1)).toBe(false);
    expect(moveBlock(editor, 9999, 1)).toBe(false);
    const callout = editorWith({
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { id: "c" },
          content: [
            { type: "calloutTitle", content: [{ type: "text", text: "T" }] },
            paragraph("x"),
          ],
        },
      ],
    });
    const inside = (callout.state.doc.firstChild?.firstChild?.nodeSize ?? 0) + 1;
    expect(moveBlock(callout, inside, -1)).toBe(false);
  });

  it("moves with Mod-Shift-ArrowUp and Mod-Shift-ArrowDown", () => {
    const editor = editorWith(three);
    editor.commands.setTextSelection(posOf(editor, "a") + 1);
    press(editor, "ArrowDown", { shiftKey: true });
    expect(outline(editor)).toEqual(["paragraph:b", "paragraph:a", "paragraph:c"]);
    press(editor, "ArrowUp", { shiftKey: true });
    expect(outline(editor)).toEqual(["paragraph:a", "paragraph:b", "paragraph:c"]);
  });
});

describe("the block the caret is in", () => {
  it("is a list item from its first line, and a table from any cell", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", attrs: { id: "i" }, content: [paragraph("item")] }],
        },
        {
          type: "table",
          attrs: { id: "t" },
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [paragraph("cell")] }],
            },
          ],
        },
      ],
    });
    editor.commands.setTextSelection(4);
    expect(currentBlock(editor)?.node.type.name).toBe("listItem");
    let cell = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.textContent === "cell" && node.type.name === "paragraph") cell = pos;
    });
    editor.commands.setTextSelection(cell + 1);
    expect(currentBlock(editor)?.node.type.name).toBe("table");
  });

  it("is the selected block", () => {
    const editor = editorWith({
      type: "doc",
      content: [{ type: "mathBlock", attrs: { latex: "x" } }],
    });
    editor.commands.setNodeSelection(0);
    expect(currentBlock(editor)?.node.type.name).toBe("mathBlock");
  });
});

describe("duplicating and deleting blocks", () => {
  it("puts a copy with a new ID after the block, with Mod-d too", () => {
    const editor = editorWith({ type: "doc", content: [paragraph("a"), paragraph("b")] });
    expect(duplicateBlock(editor, posOf(editor, "a"))).toBe(true);
    expect(outline(editor)).toEqual(["paragraph:a", "paragraph:a", "paragraph:b"]);
    const ids = editor.getJSON().content.map((node) => node.attrs?.id as string);
    expect(ids[0]).toBe("a");
    expect(new Set(ids).size).toBe(3);
    editor.commands.setTextSelection(posOf(editor, "b") + 1);
    press(editor, "d");
    expect(outline(editor)).toEqual(["paragraph:a", "paragraph:a", "paragraph:b", "paragraph:b"]);
  });

  it("selects a duplicated block without text", () => {
    const editor = editorWith({
      type: "doc",
      content: [{ type: "horizontalRule" }, paragraph("a")],
    });
    duplicateBlock(editor, 0);
    expect(editor.state.selection instanceof NodeSelection).toBe(true);
    expect(editor.state.selection.from).toBe(1);
  });

  it("deletes a block, and a list left empty", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        paragraph("a"),
        {
          type: "bulletList",
          content: [{ type: "listItem", attrs: { id: "i" }, content: [paragraph("item")] }],
        },
      ],
    });
    const list = posOf(editor, "item");
    expect(deleteBlock(editor, list + 1)).toBe(true);
    expect(outline(editor)).toEqual(["paragraph:a"]);
    expect(deleteBlock(editor, 9999)).toBe(false);
    expect(duplicateBlock(editor, 9999)).toBe(false);
  });
});

describe("turning blocks into others", () => {
  it("turns a paragraph into a heading, a list, a quote or code", () => {
    const editor = editorWith({ type: "doc", content: [paragraph("a")] });
    turnBlockInto(editor, 0, command("heading1"));
    expect(outline(editor)).toEqual(["heading:a"]);
    turnBlockInto(editor, 0, command("code"));
    expect(outline(editor)).toEqual(["codeBlock:a"]);
    turnBlockInto(editor, 0, command("text"));
    turnBlockInto(editor, 0, command("bulletList"));
    expect(outline(editor)).toEqual(["bulletList:a"]);
  });

  it("switches a list item's list, and takes it out of its list for other types", () => {
    const list = () =>
      editorWith({
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [{ type: "listItem", attrs: { id: "i" }, content: [paragraph("item")] }],
          },
        ],
      });
    let editor = list();
    expect(canTurn(editor.state.doc.firstChild?.firstChild ?? editor.state.doc)).toBe(true);
    expect(turnBlockInto(editor, 1, command("numberedList"))).toBe(true);
    expect(outline(editor)).toEqual(["orderedList:item"]);

    editor = list();
    expect(turnBlockInto(editor, 1, command("bulletList"))).toBe(true);
    expect(outline(editor)).toEqual(["bulletList:item"]);

    editor = list();
    turnBlockInto(editor, 1, command("heading2"));
    expect(outline(editor)).toEqual(["heading:item"]);

    editor = list();
    turnBlockInto(editor, 1, command("text"));
    expect(outline(editor)).toEqual(["paragraph:item"]);
  });

  it("does not turn blocks without a line of text, or into blocks it only inserts", () => {
    const editor = editorWith({
      type: "doc",
      content: [{ type: "horizontalRule" }, paragraph("a")],
    });
    expect(canTurn(editor.state.doc.child(0))).toBe(false);
    expect(turnBlockInto(editor, 0, command("heading1"))).toBe(false);
    expect(turnBlockInto(editor, 1, command("math"))).toBe(false);
    expect(turnBlockInto(editor, 9999, command("heading1"))).toBe(false);
  });
});

describe("highlighting code", () => {
  const code = (language: string | null, text: string): JSONContent => ({
    type: "codeBlock",
    attrs: { id: "c", language },
    content: [{ type: "text", text }],
  });
  const tokens = (editor: Editor) =>
    [...editor.view.dom.querySelectorAll("[class^='hljs-']")].map(
      (token) => `${token.className}:${token.textContent}`,
    );

  it("highlights the language a fence names first", () => {
    expect(codeLanguage(' ts title="a.ts"')).toBe("ts");
    expect(codeLanguage("")).toBe("");
    const editor = editorWith({ type: "doc", content: [code('ts title="a.ts"', "const x = 1;")] });
    expect(tokens(editor)).toEqual(["hljs-keyword:const", "hljs-number:1"]);
  });

  it("leaves code without a language, or in one it does not know, plain", () => {
    const editor = editorWith({
      type: "doc",
      content: [code(null, "const x = 1;"), code("mermaid", "flowchart LR\n  A --> B")],
    });
    expect(tokens(editor)).toEqual([]);
  });
});
