// Source mode keeps a note's text as the file has it: CodeMirror reads its
// line endings and writes them back, so switching modes changes no byte.
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { lineSeparatorOf } from "../src/SourceEditor.tsx";

describe("lineSeparatorOf", () => {
  it("finds the line ending a text uses first", () => {
    expect(lineSeparatorOf("a\r\nb\nc")).toBe("\r\n");
    expect(lineSeparatorOf("a\nb\r\n")).toBe("\n");
    expect(lineSeparatorOf("a\rb")).toBe("\r");
    expect(lineSeparatorOf("one line")).toBe("\n");
  });

  it("keeps a file's line endings through an edit", () => {
    const text = "# Title\r\n\r\nSome text.\r\n";
    const state = EditorState.create({
      doc: text,
      extensions: EditorState.lineSeparator.of(lineSeparatorOf(text)),
    });
    expect(state.sliceDoc()).toBe(text);
    const edited = state.update({
      changes: { from: state.doc.length, insert: `More.${state.lineBreak}` },
    }).state;
    expect(edited.sliceDoc()).toBe(`${text}More.\r\n`);
  });
});
