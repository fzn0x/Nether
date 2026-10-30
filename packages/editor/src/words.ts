// Every word the editor shows, so that each can be translated: an app
// passes its language's words to the editor, and English is the default.

/** The blocks the slash menu inserts and the block menu turns blocks into. */
export const builtInBlocks = [
  "text",
  "heading1",
  "heading2",
  "heading3",
  "bulletList",
  "numberedList",
  "taskList",
  "quote",
  "callout",
  "toggle",
  "code",
  "math",
  "diagram",
  "divider",
  "table",
  "columns",
] as const;

export type BuiltInBlock = (typeof builtInBlocks)[number];

export interface CommandWords {
  readonly title: string;
  /** More words the slash menu finds the command by, separated by spaces. */
  readonly keywords: string;
}

export interface EditorWords {
  readonly blocks: Readonly<Record<BuiltInBlock, CommandWords>>;
  /** The slash menu's name. */
  readonly slashMenu: string;
  /** What the slash menu says when no block matches. */
  readonly noBlocks: string;
  /** The handle beside a block, which drags it or opens its menu. */
  readonly blockHandle: string;
  readonly blockMenu: string;
  readonly turnInto: string;
  readonly moveUp: string;
  readonly moveDown: string;
  readonly duplicate: string;
  readonly remove: string;
  /** A field that edits math as LaTeX. */
  readonly editMath: string;
  /** Rendered math, which opens its LaTeX. */
  readonly showMath: string;
  readonly codeLanguage: string;
  readonly diagramError: string;
}

export const englishWords: EditorWords = {
  blocks: {
    text: { title: "Text", keywords: "paragraph plain" },
    heading1: { title: "Heading 1", keywords: "title h1" },
    heading2: { title: "Heading 2", keywords: "subtitle h2" },
    heading3: { title: "Heading 3", keywords: "h3" },
    bulletList: { title: "Bulleted list", keywords: "unordered points ul" },
    numberedList: { title: "Numbered list", keywords: "ordered ol" },
    taskList: { title: "Task list", keywords: "todo checkbox checklist" },
    quote: { title: "Quote", keywords: "blockquote citation" },
    callout: { title: "Callout", keywords: "note tip warning admonition" },
    toggle: { title: "Toggle", keywords: "details collapse fold" },
    code: { title: "Code", keywords: "snippet program pre" },
    math: { title: "Math", keywords: "equation latex formula tex katex" },
    diagram: { title: "Diagram", keywords: "mermaid chart flowchart graph" },
    divider: { title: "Divider", keywords: "rule separator hr line" },
    table: { title: "Table", keywords: "grid rows" },
    columns: { title: "Columns", keywords: "side layout split" },
  },
  slashMenu: "Blocks",
  noBlocks: "No blocks match",
  blockHandle: "Drag to move, or click for the block's menu",
  blockMenu: "Block",
  turnInto: "Turn into",
  moveUp: "Move up",
  moveDown: "Move down",
  duplicate: "Duplicate",
  remove: "Delete",
  editMath: "LaTeX",
  showMath: "Math, press Enter to edit",
  codeLanguage: "Language",
  diagramError: "This diagram cannot be drawn:",
};
