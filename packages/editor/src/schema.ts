// Nether's editor schema on TipTap: every block type of the core model has a
// node, so a note opens without losing anything, and every block node holds
// the block's stable ID (ADR 0002). Blocks without editing of their own yet,
// such as embeds and raw Markdown, show as cards until their views arrive.
import { type BlockId, newBlockId } from "@nether/core";
import {
  type AnyExtension,
  type Editor,
  Mark,
  Node,
  type NodeViewRenderer,
  mergeAttributes,
} from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Code from "@tiptap/extension-code";
import Highlight from "@tiptap/extension-highlight";
import { NodeSelection } from "@tiptap/pm/state";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { BlockIds } from "./ids.ts";

/** Block nodes that are blocks of the core model, and so carry an ID. */
export const blockNodes = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "callout",
  "details",
  "codeBlock",
  "mathBlock",
  "horizontalRule",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "columns",
  "column",
  "image",
  "file",
  "bookmark",
  "embed",
  "database",
  "rawBlock",
  "pluginBlock",
] as const;

/** An attribute's value as text: a string, or a number written out. */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}

/** A JSON attribute: kept as is, rendered as JSON. */
function jsonAttribute(name: string, fallback: unknown = null) {
  return {
    default: fallback,
    parseHTML: (element: HTMLElement) => {
      const value = element.getAttribute(`data-${name}`);
      if (value === null) return fallback;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return fallback;
      }
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[name] === null || attributes[name] === undefined
        ? {}
        : { [`data-${name}`]: JSON.stringify(attributes[name]) },
  };
}

/** A string attribute kept in a data attribute. */
function dataAttribute(name: string, fallback: string | number | null = null, html = name) {
  return {
    default: fallback,
    parseHTML: (element: HTMLElement) => element.getAttribute(`data-${html}`) ?? fallback,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[name] === null || attributes[name] === undefined
        ? {}
        : { [`data-${html}`]: asText(attributes[name]) },
  };
}

/** A block that holds no text of its own, shown as a card. */
function cardNode(name: string, attributes: Record<string, ReturnType<typeof dataAttribute>>) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes: () => attributes,
    parseHTML: () => [{ tag: `div[data-type="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": name, class: `card card-${name}` }),
    ],
  });
}

/** Obsidian's callout: a title line, then blocks. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "calloutTitle block*",
  defining: true,
  addAttributes: () => ({
    kind: dataAttribute("kind", "note"),
    fold: dataAttribute("fold"),
  }),
  parseHTML: () => [{ tag: "div[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-callout": "", class: "callout" }),
    0,
  ],
});

export const CalloutTitle = Node.create({
  name: "calloutTitle",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "div[data-callout-title]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-callout-title": "", class: "callout-title" }),
    0,
  ],
});

/** Columns of blocks, side by side. */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column column+",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "div[data-columns]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-columns": "", class: "columns" }),
    0,
  ],
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  addAttributes: () => ({ width: dataAttribute("width") }),
  parseHTML: () => [{ tag: "div[data-column]" }],
  renderHTML: ({ HTMLAttributes, node }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-column": "",
      class: "column",
      style: typeof node.attrs.width === "number" ? `flex: ${String(node.attrs.width)} 1 0` : "",
    }),
    0,
  ],
});

/**
 * Enter on a selected node whose view has a button, such as rendered math,
 * presses the button, as a click would, so the keyboard reaches what the
 * pointer does.
 */
function pressSelected(editor: Editor, name: string): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== name) return false;
  const dom = editor.view.nodeDOM(selection.from);
  const button = dom instanceof HTMLElement ? dom.querySelector("button") : null;
  if (button === null) return false;
  button.click();
  return true;
}

/** Display math: its LaTeX, which the math view renders. */
export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes: () => ({ latex: dataAttribute("latex", "") }),
  addKeyboardShortcuts() {
    return { Enter: () => pressSelected(this.editor, this.name) };
  },
  parseHTML: () => [{ tag: 'div[data-type="mathBlock"]' }],
  renderHTML: ({ HTMLAttributes, node }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "mathBlock", class: "math-block" }),
    String(node.attrs.latex),
  ],
});

/** An image on a line of its own. */
export const Image = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({
    src: { default: "" },
    alt: { default: null },
    title: { default: null },
    width: dataAttribute("width"),
  }),
  parseHTML: () => [{ tag: "img[src]" }],
  renderHTML: ({ HTMLAttributes }) => ["img", mergeAttributes(HTMLAttributes, { class: "image" })],
});

export const File = cardNode("file", {
  src: dataAttribute("src", ""),
  name: dataAttribute("name"),
});
export const Bookmark = cardNode("bookmark", { url: dataAttribute("url", "") });
export const Embed = cardNode("embed", {
  target: jsonAttribute("target"),
  alias: dataAttribute("alias"),
} as Record<string, ReturnType<typeof dataAttribute>>);
export const Database = cardNode("database", {
  database: dataAttribute("database", ""),
  view: dataAttribute("view"),
});
export const RawBlock = cardNode("rawBlock", { text: dataAttribute("text", "") });
export const PluginBlock = cardNode("pluginBlock", {
  pluginType: dataAttribute("pluginType", "", "plugin-type"),
  data: jsonAttribute("data", {}),
} as Record<string, ReturnType<typeof dataAttribute>>);

/** An inline atom, shown as a chip. */
function chipNode(
  name: string,
  attributes: Record<string, unknown>,
  text: (attrs: Record<string, unknown>) => string,
) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: () => attributes,
    parseHTML: () => [{ tag: `span[data-type="${name}"]` }],
    renderHTML: ({ HTMLAttributes, node }) => [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": name, class: `chip chip-${name}` }),
      text(node.attrs),
    ],
    renderText: ({ node }) => text(node.attrs),
  });
}

function targetText(target: unknown): string {
  if (typeof target !== "object" || target === null) return "";
  const parts = target as { title?: string; note?: string; heading?: string; block?: string };
  let text = parts.title ?? parts.note ?? "";
  if (parts.heading !== undefined) text += `#${parts.heading}`;
  if (parts.block !== undefined) text += `#^${parts.block}`;
  return text;
}

export const WikiLink = chipNode(
  "wikiLink",
  { target: jsonAttribute("target"), alias: dataAttribute("alias") },
  (attrs) => (typeof attrs.alias === "string" ? attrs.alias : targetText(attrs.target)),
);
export const Tag = chipNode(
  "tag",
  { name: dataAttribute("name", "") },
  (attrs) => `#${asText(attrs.name)}`,
);
export const MathInline = chipNode("mathInline", { latex: dataAttribute("latex", "") }, (attrs) =>
  asText(attrs.latex),
).extend({
  addKeyboardShortcuts() {
    return { Enter: () => pressSelected(this.editor, this.name) };
  },
});
export const RawInline = chipNode(
  "rawInline",
  { markdown: dataAttribute("markdown", "") },
  (attrs) => asText(attrs.markdown),
);

/**
 * Inline code that other formatting can wrap, as Markdown allows: **`bold
 * code`** and [`a link`](url). TipTap's own code mark excludes every other.
 */
export const InlineCode = Code.extend({ excludes: "code" });

/** Obsidian's `%%comment%%`: text that stays in the file but is not shown in reading views. */
export const Comment = Mark.create({
  name: "comment",
  parseHTML: () => [{ tag: "span[data-comment]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-comment": "", class: "comment" }),
    0,
  ],
});

/** A table, with each column's alignment. */
export const NetherTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: jsonAttribute("align", []),
    };
  },
});

const lowlight = createLowlight(common);

/** The language of a code fence's info string, such as `ts` in `ts title="a.ts"`. */
export function codeLanguage(info: string): string {
  return info.trim().split(/\s/)[0] ?? "";
}

/**
 * Highlights code in the languages lowlight knows. Code without a language,
 * or in one it does not know such as Mermaid, stays plain: guessing would
 * run every grammar over every such block on each change, and guess wrong.
 */
const highlighter = {
  ...lowlight,
  registered: (info: string) => lowlight.registered(codeLanguage(info)),
  highlight: (info: string, value: string) => lowlight.highlight(codeLanguage(info), value),
  highlightAuto: (value: string) => ({
    type: "root",
    children: [{ type: "text", value }],
    data: { language: undefined, relevance: 0 },
  }),
};

/** How nodes show in a page, by node name; nodes without one render their HTML. */
export type NodeViews = Readonly<Partial<Record<string, NodeViewRenderer>>>;

export interface SchemaOptions {
  /** Makes a new block's ID; by default eight random letters and digits. */
  readonly newId?: () => BlockId;
  /** The views of nodes that edit or render in a way of their own, such as math. */
  readonly nodeViews?: NodeViews;
}

/** The TipTap extensions that make Nether's schema. */
export function netherExtensions(options: SchemaOptions = {}): AnyExtension[] {
  const withView = (node: Node): Node => {
    const view = options.nodeViews?.[node.name];
    return view === undefined ? node : node.extend({ addNodeView: () => view });
  };
  return [
    StarterKit.configure({
      // Links open on Ctrl or Cmd and click, as in other editors.
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      // Nether writes no empty paragraph at the end of a note.
      trailingNode: false,
      code: false,
      codeBlock: false,
    }),
    InlineCode,
    // The same node as StarterKit's, with the code highlighted.
    withView(CodeBlockLowlight.configure({ lowlight: highlighter })),
    TaskList,
    TaskItem.configure({ nested: true }),
    NetherTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    Highlight,
    Comment,
    Callout,
    CalloutTitle,
    Columns,
    Column,
    withView(MathBlock),
    Image,
    File,
    Bookmark,
    Embed,
    Database,
    RawBlock,
    PluginBlock,
    WikiLink,
    Tag,
    withView(MathInline),
    RawInline,
    BlockIds.configure({
      types: [...blockNodes],
      generate: options.newId ?? (() => newBlockId()),
    }),
  ];
}
