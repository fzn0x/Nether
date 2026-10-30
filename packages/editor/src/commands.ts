// The blocks people can insert, or turn a block into: the slash menu lists
// them, and the block menu offers the ones a block can become. Plugins will
// add theirs to the same list.
import type { Editor, JSONContent } from "@tiptap/core";
import { type BuiltInBlock, type EditorWords, englishWords } from "./words.ts";

export interface BlockCommand {
  readonly id: string;
  readonly title: string;
  /** More words the slash menu finds the command by, separated by spaces. */
  readonly keywords: string;
  /**
   * What the block menu can turn a block of text into with this: a block
   * of another type, or a list. Commands without it only insert.
   */
  readonly turns?: "block" | "list";
  /** Runs the command where the selection is. */
  readonly run: (editor: Editor) => void;
}

function insert(content: JSONContent) {
  return (editor: Editor) => {
    editor.chain().focus().insertContent(content).run();
  };
}

const runs: Readonly<Record<BuiltInBlock, Omit<BlockCommand, "id" | "title" | "keywords">>> = {
  text: { turns: "block", run: (editor) => editor.chain().focus().setParagraph().run() },
  heading1: {
    turns: "block",
    run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  heading2: {
    turns: "block",
    run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  heading3: {
    turns: "block",
    run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  bulletList: { turns: "list", run: (editor) => editor.chain().focus().toggleBulletList().run() },
  numberedList: {
    turns: "list",
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  taskList: { turns: "list", run: (editor) => editor.chain().focus().toggleTaskList().run() },
  quote: { turns: "block", run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  callout: {
    run: insert({
      type: "callout",
      attrs: { kind: "note" },
      content: [{ type: "calloutTitle" }, { type: "paragraph" }],
    }),
  },
  toggle: {
    run: insert({
      type: "details",
      attrs: { open: true },
      content: [
        { type: "detailsSummary" },
        { type: "detailsContent", content: [{ type: "paragraph" }] },
      ],
    }),
  },
  code: { turns: "block", run: (editor) => editor.chain().focus().setCodeBlock().run() },
  math: { run: insert({ type: "mathBlock", attrs: { latex: "" } }) },
  diagram: {
    run: insert({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: "flowchart LR\n  A --> B" }],
    }),
  },
  divider: { run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  table: {
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  columns: {
    run: insert({
      type: "columns",
      content: [
        { type: "column", content: [{ type: "paragraph" }] },
        { type: "column", content: [{ type: "paragraph" }] },
      ],
    }),
  },
};

/** The built-in block commands, in the words of the app's language. */
export function blockCommands(words: EditorWords = englishWords): BlockCommand[] {
  return Object.entries(runs).map(([id, command]) => ({
    id,
    ...words.blocks[id as BuiltInBlock],
    ...command,
  }));
}

/**
 * The commands that match what was typed after the slash: each word typed
 * must start a word of the command's title or keywords, in any order.
 */
export function findCommands(query: string, commands: readonly BlockCommand[]): BlockCommand[] {
  const typed = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (typed.length === 0) return [...commands];
  return commands.filter((command) => {
    const words = `${command.title} ${command.keywords}`.toLocaleLowerCase().split(/[\s-]+/);
    return typed.every((word) => words.some((part) => part.startsWith(word)));
  });
}
