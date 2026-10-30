// @vitest-environment jsdom
// Files in a note: what kind each link names, where it loads from, and the
// files pasted or dropped into a note, which become embeds.
import type { BlockId } from "@nether/core";
import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileDrop,
  type NoteFiles,
  embedSize,
  fileKind,
  fileUrl,
  isNoteLink,
  isWebLink,
  markdownPath,
} from "../src/files.ts";
import { fromEditor } from "../src/convert.ts";
import { netherExtensions } from "../src/schema.ts";

describe("the files a note links to", () => {
  it("knows images, PDFs, audio and video by their extension", () => {
    expect(fileKind("photo.PNG")).toBe("image");
    expect(fileKind("https://example.com/a.webp?size=2#top")).toBe("image");
    expect(fileKind("paper.pdf")).toBe("pdf");
    expect(fileKind("talk.m4a")).toBe("audio");
    expect(fileKind("clip.webm")).toBe("video");
    expect(fileKind("archive.zip")).toBe("file");
  });

  it("tells notes from other files", () => {
    expect(isNoteLink("Roadmap")).toBe(true);
    expect(isNoteLink("Projects/Roadmap.md")).toBe(true);
    expect(isNoteLink("v1.2 notes")).toBe(true);
    expect(isNoteLink("photo.png")).toBe(false);
    expect(isNoteLink("folder.d/archive.tar")).toBe(false);
  });

  it("loads web links as they are, and asks the app for the vault's files", () => {
    const asked: string[] = [];
    const files: NoteFiles = {
      url: (link) => {
        asked.push(link);
        return link === "missing.png" ? undefined : `media/${link}`;
      },
    };
    expect(isWebLink("https://example.com/a.png")).toBe(true);
    expect(isWebLink("data:image/png;base64,AA")).toBe(true);
    expect(isWebLink("data:text/html,x")).toBe(false);
    expect(fileUrl(files, "https://example.com/a.png", true)).toBe("https://example.com/a.png");
    expect(fileUrl(files, "my%20photo.png", true)).toBe("media/my photo.png");
    expect(fileUrl(files, "my%20photo.png", false)).toBe("media/my%20photo.png");
    expect(fileUrl(files, "missing.png", false)).toBeUndefined();
    expect(fileUrl(undefined, "a.png", false)).toBeUndefined();
    expect(asked).toEqual(["my photo.png", "my%20photo.png", "missing.png"]);
    expect(markdownPath("bad%E0%A4%A.png")).toBe("bad%E0%A4%A.png");
  });

  it("reads an embed's size from its alias", () => {
    expect(embedSize("300")).toEqual({ width: 300 });
    expect(embedSize(" 300x200 ")).toEqual({ width: 300, height: 200 });
    expect(embedSize("0")).toEqual({});
    expect(embedSize("a caption")).toEqual({});
    expect(embedSize(undefined)).toEqual({});
  });
});

describe("pasting and dropping files", () => {
  const editors: Editor[] = [];
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  function editorWith(files: NoteFiles | undefined): Editor {
    let next = 0;
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        ...netherExtensions({ newId: () => `n${String(next++)}` as BlockId }),
        FileDrop.configure({ files }),
      ],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "before" }] }],
      },
    });
    editors.push(editor);
    return editor;
  }

  const attaching: NoteFiles = {
    url: () => undefined,
    attach: (file, pasted) =>
      file.name === "fails.png"
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve(`${pasted ? "Pasted" : "Dropped"} ${file.name}`),
  };

  function file(name: string): File {
    return new File(["x"], name, { type: "image/png" });
  }

  function paste(editor: Editor, files: File[]): boolean {
    // Other plugins read the pasted text first.
    const event = { clipboardData: { files, getData: () => "" } } as unknown as ClipboardEvent;
    return (
      editor.view.someProp("handlePaste", (handle) => handle(editor.view, event, Slice.empty)) ??
      false
    );
  }

  /** Drops files at a position in the note, or on no block when `at` is null. */
  function drop(editor: Editor, files: File[], at: number | null = null): boolean {
    // jsdom lays nothing out: say where the pointer is in the note.
    editor.view.posAtCoords = () => (at === null ? null : { pos: at, inside: -1 });
    const event = {
      dataTransfer: { files },
      clientX: 0,
      clientY: 0,
      preventDefault: () => undefined,
    } as unknown as DragEvent;
    return (
      editor.view.someProp("handleDrop", (handle) =>
        handle(editor.view, event, Slice.empty, false),
      ) ?? false
    );
  }

  async function settled() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function embeds(editor: Editor): string[] {
    return fromEditor(editor.getJSON(), () => "x" as BlockId).flatMap((block) =>
      block.type === "embed" && "title" in block.attrs.target ? [block.attrs.target.title] : [],
    );
  }

  it("embeds pasted files where the caret is, leaving notes and failures out", async () => {
    const editor = editorWith(attaching);
    editor.commands.setTextSelection(7);
    expect(paste(editor, [file("a.png"), file("fails.png"), file("Note.md"), file("b.png")])).toBe(
      true,
    );
    await settled();
    expect(embeds(editor)).toEqual(["Pasted a.png", "Pasted b.png"]);
    expect(paste(editor, [file("Only.md")])).toBe(false);
  });

  it("embeds dropped files after the block they land on, or between blocks", async () => {
    const editor = editorWith(attaching);
    const types = () => editor.getJSON().content.map((node) => node.type);
    // In the paragraph's text: after the paragraph.
    expect(drop(editor, [file("c.png")], 3)).toBe(true);
    await settled();
    expect(types()).toEqual(["paragraph", "embed"]);
    // Before the first block.
    drop(editor, [file("d.png")], 0);
    await settled();
    expect(types()).toEqual(["embed", "paragraph", "embed"]);
    // On no block: at the note's end.
    drop(editor, [file("e.png")]);
    await settled();
    expect(embeds(editor)).toEqual(["Dropped d.png", "Dropped c.png", "Dropped e.png"]);
  });

  it("leaves pastes and drops alone when the app cannot add files", () => {
    const editor = editorWith({ url: () => undefined });
    expect(paste(editor, [file("a.png")])).toBe(false);
    expect(drop(editor, [file("a.png")])).toBe(false);
  });
});
