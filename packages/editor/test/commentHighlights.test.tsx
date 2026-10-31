// @vitest-environment jsdom
// A note's comment threads in its editor (ADR 0044): a thread starts from
// the selection, or from a block's menu; its text is highlighted, through
// others' edits, and falls back to its block once the text is gone; and a
// click on the highlight makes its thread active.
import type { BlockId, ContentBlock } from "@nether/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { type CommentAnchor, readThreads, startThread } from "../src/comments.ts";
import { setDocumentBlocks } from "../src/document.ts";
import { NoteEditor, type NoteCommentsView } from "../src/NoteEditor.tsx";

// React's act, outside a test renderer, asks to be told it runs in one.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out, so it scrolls nothing.
Element.prototype.scrollIntoView = () => undefined;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const paragraph = (id: string, text: string): ContentBlock => ({
  id: id as BlockId,
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** A note's document holding two paragraphs. */
function noteDocument(): Y.Doc {
  const document = new Y.Doc();
  setDocumentBlocks(document, [paragraph("one", "Plan the launch"), paragraph("two", "Then rest")]);
  return document;
}

const ada = { id: "a", name: "Ada" };

/** An editor on a note's document, showing its comments; gives a way to show them anew. */
function mount(document: Y.Doc, view: Partial<NoteCommentsView> = {}) {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  const show = (next: Partial<NoteCommentsView>) => {
    act(() => {
      root.render(
        <NoteEditor
          document={document}
          label="Note"
          comments={{
            threads: [],
            active: undefined,
            onActivate: () => undefined,
            request: 0,
            ...next,
          }}
        />,
      );
    });
  };
  show(view);
  cleanups.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  const editorView = () => {
    // TipTap keeps its editor on the editing element.
    const element = container.querySelector<Element & { editor?: { view: EditorView } }>(
      ".ProseMirror",
    );
    const found = element?.editor?.view;
    if (found === undefined) throw new Error("No editor");
    return found;
  };
  return { container, show, view: editorView };
}

/** Selects the first occurrence of `text` in the editor. */
function select(view: EditorView, text: string): void {
  let from: number | undefined;
  view.state.doc.descendants((node, pos) => {
    if (from !== undefined) return false;
    const index = node.isText ? (node.text ?? "").indexOf(text) : -1;
    if (index >= 0) from = pos + index;
    return true;
  });
  if (from === undefined) throw new Error(`No ${text} in the note`);
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + text.length)),
  );
}

function highlights(container: Element): string[] {
  return [...container.querySelectorAll(".comment-highlight")].map((each) => each.textContent);
}

describe("comment highlights", () => {
  it("starts a thread on the selection, and highlights its text", () => {
    const document = noteDocument();
    const comments = new Y.Doc();
    const anchors: CommentAnchor[] = [];
    const onComment = (anchor: CommentAnchor) => anchors.push(anchor);
    const { container, show, view } = mount(document, { onComment });
    select(view(), "the launch");
    show({ onComment, request: 1 });
    expect(anchors).toHaveLength(1);
    const [anchor] = anchors;
    if (anchor === undefined) throw new Error("No anchor");
    expect(anchor).toMatchObject({ quote: "the launch", block: "one" });

    startThread(comments, anchor, ada, "When?");
    const threads = readThreads(comments);
    show({ onComment, request: 1, threads, active: threads[0]?.id });
    expect(highlights(container)).toEqual(["the launch"]);
    expect(container.querySelector(".comment-highlight.active")?.textContent).toBe("the launch");
  });

  it("starts a thread on the block the caret is in, with nothing selected", () => {
    const anchors: CommentAnchor[] = [];
    const onComment = (anchor: CommentAnchor) => anchors.push(anchor);
    const { show, view } = mount(noteDocument(), { onComment });
    const editor = view();
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 20)));
    show({ onComment, request: 1 });
    expect(anchors[0]).toMatchObject({ quote: "Then rest", block: "two" });
  });

  it("offers nothing to comment on where comments are not offered", () => {
    const { show, view } = mount(noteDocument());
    select(view(), "the launch");
    // No onComment: the request does nothing, and nothing fails.
    show({ request: 1 });
    expect(view().state.selection.empty).toBe(false);
  });

  it("keeps the highlight on its text through another's edit before it", () => {
    const document = noteDocument();
    const elsewhere = new Y.Doc();
    Y.applyUpdate(elsewhere, Y.encodeStateAsUpdate(document));
    const comments = new Y.Doc();
    const anchors: CommentAnchor[] = [];
    const onComment = (anchor: CommentAnchor) => anchors.push(anchor);
    const { container, show, view } = mount(document, { onComment });
    select(view(), "launch");
    show({ onComment, request: 1 });
    const [anchor] = anchors;
    if (anchor === undefined) throw new Error("No anchor");
    startThread(comments, anchor, ada, "Which one?");
    show({ onComment, request: 1, threads: readThreads(comments) });
    expect(highlights(container)).toEqual(["launch"]);

    // Someone else types at the start of the note.
    const text = elsewhere.getXmlFragment("content").get(0) as Y.XmlElement;
    (text.get(0) as Y.XmlText).insert(0, "First, ");
    act(() => {
      Y.applyUpdate(document, Y.encodeStateAsUpdate(elsewhere), "server");
    });
    expect(view().state.doc.textContent).toContain("First, Plan the launch");
    expect(highlights(container)).toEqual(["launch"]);
  });

  it("falls back to the thread's block once its text is gone", () => {
    const document = noteDocument();
    const comments = new Y.Doc();
    const anchors: CommentAnchor[] = [];
    const onComment = (anchor: CommentAnchor) => anchors.push(anchor);
    const { container, show, view } = mount(document, { onComment });
    select(view(), "rest");
    show({ onComment, request: 1 });
    const [anchor] = anchors;
    if (anchor === undefined) throw new Error("No anchor");
    startThread(comments, anchor, ada, "Really?");
    // Its text deleted, here.
    act(() => {
      const editor = view();
      select(editor, "rest");
      editor.dispatch(editor.state.tr.deleteSelection());
    });
    show({ onComment, request: 1, threads: readThreads(comments) });
    expect(highlights(container)).toEqual(["Then "]);
  });

  it("makes a thread active when its highlight is clicked", () => {
    const document = noteDocument();
    const comments = new Y.Doc();
    const anchors: CommentAnchor[] = [];
    const activated: string[] = [];
    const base = {
      onComment: (anchor: CommentAnchor) => anchors.push(anchor),
      onActivate: (thread: string) => activated.push(thread),
    };
    const { show, view } = mount(document, base);
    select(view(), "Plan");
    show({ ...base, request: 1 });
    const [anchor] = anchors;
    if (anchor === undefined) throw new Error("No anchor");
    const id = startThread(comments, anchor, ada, "Good");
    show({ ...base, request: 1, threads: readThreads(comments) });

    const editor = view();
    const click = (pos: number) =>
      editor.someProp("handleClick", (handle) => handle(editor, pos, new MouseEvent("click")));
    click(2);
    expect(activated).toEqual([id]);
    click(14);
    expect(activated).toEqual([id]);
  });
});
