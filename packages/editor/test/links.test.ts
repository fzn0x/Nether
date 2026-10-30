// @vitest-environment jsdom
// Links between notes in the editor: their text read as Obsidian writes
// it, `[[Note]]` typed in full becoming a link, and a link opening its note
// on a click or on Enter.
import type { BlockId, LinkTarget } from "@nether/core";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { LinkMenu, type NoteLinks } from "../src/LinkMenu.tsx";
import { netherExtensions, parseLinkText } from "../src/schema.ts";

describe("parseLinkText", () => {
  it("reads a note, a heading or block in it, and an alias", () => {
    expect(parseLinkText("Roadmap")).toEqual({ target: { title: "Roadmap" } });
    expect(parseLinkText(" Projects/Roadmap#Next step | the plan ")).toEqual({
      target: { title: "Projects/Roadmap", heading: "Next step" },
      alias: "the plan",
    });
    expect(parseLinkText("Roadmap#^b1")).toEqual({ target: { title: "Roadmap", block: "b1" } });
    expect(parseLinkText("Roadmap^b1")).toEqual({ target: { title: "Roadmap", block: "b1" } });
    expect(parseLinkText("#Heading")).toEqual({ target: { heading: "Heading" } });
    expect(parseLinkText("#^b2|here")).toEqual({ target: { block: "b2" }, alias: "here" });
    expect(parseLinkText(" | alias")).toBeUndefined();
  });
});

describe("links in the editor", () => {
  const editors: Editor[] = [];
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  function editorWith(links?: NoteLinks): Editor {
    let next = 0;
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        ...netherExtensions({ newId: () => `n${String(next++)}` as BlockId }),
        ...(links === undefined ? [] : [LinkMenu.configure({ links })]),
      ],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editors.push(editor);
    return editor;
  }

  /** Types text as the browser would, so input rules see it. */
  function type(editor: Editor, text: string) {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (handle) =>
        handle(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
      );
      if (handled !== true) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  }

  it("makes a link of `[[Note]]` typed in full", () => {
    const editor = editorWith();
    type(editor, "See [[Projects/Roadmap#Next|the plan]] now");
    const paragraph = editor.getJSON().content[0];
    expect(paragraph?.content).toEqual([
      { type: "text", text: "See " },
      {
        type: "wikiLink",
        attrs: { target: { title: "Projects/Roadmap", heading: "Next" }, alias: "the plan" },
      },
      { type: "text", text: " now" },
    ]);
    // Brackets with nothing to link stay as typed.
    type(editor, " [[ ]]");
    expect(editor.getText()).toContain("[[ ]]");
  });

  it("opens a link's note on a click, or on Enter when it is selected", () => {
    const opened: LinkTarget[] = [];
    const editor = editorWith({ suggest: () => [], open: (target) => opened.push(target) });
    type(editor, "[[Ideas]]");
    const node = editor.state.doc.nodeAt(1);
    expect(node?.type.name).toBe("wikiLink");
    const clicked = editor.view.someProp("handleClickOn", (handle) =>
      node === null ? false : handle(editor.view, 1, node, 1, new MouseEvent("click"), true),
    );
    expect(clicked).toBe(true);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)));
    editor.view.someProp("handleKeyDown", (handle) =>
      handle(editor.view, new KeyboardEvent("keydown", { key: "Enter" })),
    );
    expect(opened).toEqual([{ title: "Ideas" }, { title: "Ideas" }]);
    // Enter elsewhere is Enter.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.someProp("handleKeyDown", (handle) =>
      handle(editor.view, new KeyboardEvent("keydown", { key: "Enter" })),
    );
    expect(opened).toHaveLength(2);
  });
});
