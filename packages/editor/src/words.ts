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
  "query",
  "divider",
  "table",
  "columns",
  "image",
  "file",
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
  /** The block menu's action that starts a comment thread on the block. */
  readonly comment: string;
  /** A field that edits math as LaTeX. */
  readonly editMath: string;
  /** Rendered math, which opens its LaTeX. */
  readonly showMath: string;
  readonly codeLanguage: string;
  readonly diagramError: string;
  /** A field for the path or URL of an image or file block that has none. */
  readonly fileLink: string;
  readonly chooseFile: string;
  /** What an embed of a file the vault does not have says, before its link. */
  readonly missingFile: string;
  /** What an embed of a file the page cannot show says, before its link. */
  readonly brokenFile: string;
  /** Opens a file in the system's app for it. */
  readonly openFile: string;
  /** Shows a file in the system's file manager. */
  readonly revealFile: string;
  /** What an embedded note says, before its link, until notes can be embedded. */
  readonly embeddedNote: string;
  /** The `[[` menu's name. */
  readonly linkMenu: string;
  /** What the `[[` menu says when no note matches. */
  readonly noNotes: string;
  /** What an embed of a note the vault does not have says, before its link. */
  readonly missingNote: string;
  /** A synced block's editor, before the name of the note it comes from. */
  readonly syncedBlock: string;
  /** Before why a synced block's edit could not be written to its note. */
  readonly syncFailed: string;
  /** Fetches a web link's preview. */
  readonly showPreview: string;
  /** What the preview button says while it fetches. */
  readonly fetchingPreview: string;
  /** Before why a preview could not be fetched. */
  readonly previewFailed: string;
  /** Opens a web link in the system's browser. */
  readonly openLink: string;
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
    query: { title: "Query", keywords: "base dataview filter search find" },
    divider: { title: "Divider", keywords: "rule separator hr line" },
    table: { title: "Table", keywords: "grid rows" },
    columns: { title: "Columns", keywords: "side layout split" },
    image: { title: "Image", keywords: "picture photo img" },
    file: { title: "File", keywords: "pdf audio video attachment embed" },
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
  comment: "Comment",
  editMath: "LaTeX",
  showMath: "Math, press Enter to edit",
  codeLanguage: "Language",
  diagramError: "This diagram cannot be drawn:",
  fileLink: "Path or URL of the file",
  chooseFile: "Choose a file",
  missingFile: "Not in the vault",
  brokenFile: "Cannot be shown",
  openFile: "Open",
  revealFile: "Show in folder",
  embeddedNote: "Embedded note",
  linkMenu: "Notes",
  noNotes: "No note by that name: type ]] to link to a new one",
  showPreview: "Show preview",
  fetchingPreview: "Fetching the preview…",
  previewFailed: "The preview could not be fetched",
  openLink: "Open",
  missingNote: "No such note or part of one",
  syncedBlock: "Synced block from",
  syncFailed: "This block could not be saved to its note:",
};
