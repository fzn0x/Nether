// A note's blocks to Markdown, through an mdast syntax tree and
// mdast-util-to-markdown, which knows what to escape. Handlers write
// Obsidian's syntax for wiki links, tags, highlights, comments and callouts.
import type {
  BlockId,
  BulletListItem,
  ContentBlock,
  Inline,
  LinkTarget,
  Mark,
  NoteId,
  NumberedListItem,
  TaskListItem,
} from "@nether/core";
import type {
  Delete,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  TableCell,
  TableRow,
  Text,
} from "mdast";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import {
  type AttentionInfo,
  type Handle,
  type Info,
  type Options,
  type State,
  type Unsafe,
  defaultHandlers,
  toMarkdown,
} from "mdast-util-to-markdown";
import type {
  CommentNode,
  HighlightNode,
  RawBlockNode,
  RawInlineNode,
  TagNode,
  UnderlineNode,
  WikiLinkNode,
} from "./mdast.ts";
import type { Style } from "./source.ts";
import { markdownToTree } from "./tree.ts";

declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    highlight: "highlight";
    strikethrough: "strikethrough";
    underline: "underline";
  }
}

export type ListItemBlock = BulletListItem | NumberedListItem | TaskListItem;

export interface WriteContext {
  readonly style: Style;
  /** Whether a block's ID is written into the file as `^id`. */
  readonly writeId: (id: BlockId) => boolean;
  /** The title to write for a link to a note given by its ID. */
  readonly noteTitle: (note: NoteId) => string | undefined;
}

/** The text of a wiki link between its brackets: `title#heading|alias`. */
export function wikiLinkText(
  target: LinkTarget,
  alias: string | undefined,
  noteTitle: (note: NoteId) => string | undefined,
): string {
  let text = "note" in target ? (noteTitle(target.note) ?? target.note) : "";
  if ("title" in target) text = target.title;
  if ("heading" in target) text += `#${target.heading}`;
  if ("block" in target) text += `#^${target.block}`;
  return alias === undefined ? text : `${text}|${alias}`;
}

export function isListItem(block: ContentBlock): block is ListItemBlock {
  return (
    block.type === "bulletListItem" ||
    block.type === "numberedListItem" ||
    block.type === "taskListItem"
  );
}

/** Whether two blocks are items of one Markdown list when written one after the other. */
export function sameList(a: ContentBlock, b: ContentBlock): boolean {
  if (!isListItem(a) || !isListItem(b)) return false;
  return (a.type === "numberedListItem") === (b.type === "numberedListItem");
}

function text(value: string): Text {
  return { type: "text", value };
}

function rawInline(value: string): RawInlineNode {
  return { type: "rawInline", value };
}

function html(value: string): RootContent {
  return { type: "html", value };
}

function characterReference(char: string): RawInlineNode {
  return rawInline(`&#x${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()};`);
}

function sameMark(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  if (a.type !== "link" || b.type !== "link") return true;
  return a.href === b.href && a.title === b.title;
}

function sameMarkList(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark) => b.some((other) => sameMark(mark, other)));
}

// Marks that wrap other content; code and comments are leaves.
function wraps(mark: Mark): boolean {
  return mark.type !== "code" && mark.type !== "comment";
}

type Wrapper = Extract<
  PhrasingContent,
  { type: "strong" | "emphasis" | "delete" | "link" | "highlight" | "underline" }
>;

function wrapper(mark: Mark): Wrapper {
  switch (mark.type) {
    case "bold":
      return { type: "strong", children: [] };
    case "italic":
      return { type: "emphasis", children: [] };
    case "strike":
      return { type: "delete", children: [] };
    case "highlight":
      return { type: "highlight", children: [] } satisfies HighlightNode;
    case "underline":
      return { type: "underline", children: [] } satisfies UnderlineNode;
    case "link":
      return { type: "link", url: mark.href, title: mark.title ?? null, children: [] };
    default:
      throw new Error(`${mark.type} does not wrap content`);
  }
}

function marksOf(inline: Inline): readonly Mark[] {
  return "marks" in inline ? (inline.marks ?? []) : [];
}

const tagCharacter = /^[\p{L}\p{N}\p{M}_/-]/u;

export function phrasing(
  inlines: readonly Inline[],
  context: WriteContext,
  cell = false,
): PhrasingContent[] {
  const root: PhrasingContent[] = [];
  const stack: { mark: Mark; node: Wrapper }[] = [];
  const has = (inline: Inline | undefined, mark: Mark): boolean =>
    inline !== undefined && marksOf(inline).some((other) => sameMark(other, mark));
  const run = (mark: Mark, from: number): number => {
    let length = 0;
    while (has(inlines[from + length], mark)) length++;
    return length;
  };

  inlines.forEach((inline, index) => {
    const marks = marksOf(inline).filter(wraps);
    let keep = 0;
    for (const open of stack) {
      if (!marks.some((mark) => sameMark(mark, open.mark))) break;
      keep++;
    }
    stack.length = keep;
    const opening = marks
      .filter((mark) => !stack.some((open) => sameMark(open.mark, mark)))
      .sort((a, b) => run(b, index) - run(a, index));
    for (const mark of opening) {
      const node = wrapper(mark);
      (stack[stack.length - 1]?.node.children ?? root).push(node);
      stack.push({ mark, node });
    }
    const into = stack[stack.length - 1]?.node.children ?? root;
    into.push(...leaf(inline, inlines[index - 1], context, cell));
  });
  return root;
}

function leaf(
  inline: Inline,
  previous: Inline | undefined,
  context: WriteContext,
  cell: boolean,
): PhrasingContent[] {
  switch (inline.type) {
    case "text": {
      const marks = inline.marks ?? [];
      if (marks.some((mark) => mark.type === "comment")) {
        return [{ type: "obsidianComment", value: inline.text } satisfies CommentNode];
      }
      if (marks.some((mark) => mark.type === "code")) {
        return [{ type: "inlineCode", value: inline.text }];
      }
      // A character that would join the syntax right before it is written as a
      // reference. A mark that opens or closes between them keeps them apart.
      const first = inline.text.charAt(0);
      const touching =
        previous !== undefined &&
        sameMarkList(marksOf(previous).filter(wraps), (inline.marks ?? []).filter(wraps));
      const joins =
        touching &&
        ((previous.type === "tag" && tagCharacter.test(first)) ||
          (previous.type === "math" && /^\d/.test(first)) ||
          (previous.type === "text" &&
            (previous.marks ?? []).some((mark) => mark.type === "comment") &&
            first === "%"));
      if (joins) {
        const rest = inline.text.slice(first.length);
        return rest === "" ? [characterReference(first)] : [characterReference(first), text(rest)];
      }
      return [text(inline.text)];
    }
    case "hardBreak":
      // A table cell holds one line: a break in it is written as HTML, as Obsidian does.
      return cell ? [rawInline("<br>")] : [{ type: "break" }];
    case "wikiLink":
      return [
        {
          type: "wikiLink",
          embed: false,
          value: wikiLinkText(inline.target, inline.alias, context.noteTitle),
        } satisfies WikiLinkNode,
      ];
    case "tag":
      return [{ type: "tag", value: inline.name } satisfies TagNode];
    case "math":
      return [{ type: "inlineMath", value: inline.latex.trim() }];
    case "raw":
      return [rawInline(inline.markdown)];
  }
}

/**
 * A callout's title without white space at its ends. Markdown drops plain
 * space there, and space in bold at the start would make the space before
 * the title be written as `&#x20;`, which reads back as part of it.
 */
export function trimEdges(inlines: readonly Inline[]): Inline[] {
  const out = [...inlines];
  for (let first = out[0]; first?.type === "text"; first = out[0]) {
    const text = first.text.trimStart();
    if (text !== "") {
      out[0] = { ...first, text };
      break;
    }
    out.shift();
  }
  for (let last = out[out.length - 1]; last?.type === "text"; last = out[out.length - 1]) {
    const text = last.text.trimEnd();
    if (text !== "") {
      out[out.length - 1] = { ...last, text };
      break;
    }
    out.pop();
  }
  return out;
}

function idSuffix(id: BlockId, context: WriteContext): PhrasingContent[] {
  return context.writeId(id) ? [rawInline(` ^${id}`)] : [];
}

/** Blocks that cannot end in `^id` take it on a line of its own after them. */
function withId(id: BlockId, nodes: RootContent[], context: WriteContext): RootContent[] {
  if (!context.writeId(id)) return nodes;
  return [...nodes, { type: "paragraph", children: [rawInline(`^${id}`)] }];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainText(inlines: readonly Inline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case "text":
          return inline.text;
        case "hardBreak":
          return " ";
        case "wikiLink":
          return inline.alias ?? wikiLinkText(inline.target, undefined, () => undefined);
        case "tag":
          return `#${inline.name}`;
        case "math":
          return inline.latex;
        case "raw":
          return inline.markdown;
      }
    })
    .join("")
    .replace(/\s+/g, " ");
}

export function listItem(block: ListItemBlock, context: WriteContext): ListItem {
  const children = block.children ?? [];
  const paragraph: Paragraph = {
    type: "paragraph",
    children: [...phrasing(block.content, context), ...idSuffix(block.id, context)],
  };
  return {
    type: "listItem",
    spread: children.some((child) => !isListItem(child)),
    checked: block.type === "taskListItem" ? block.attrs.checked : null,
    children: [paragraph, ...(blocksToMdast(children, context) as ListItem["children"])],
  };
}

export function blocksToMdast(
  blocks: readonly ContentBlock[],
  context: WriteContext,
): RootContent[] {
  const out: RootContent[] = [];
  let list: List | undefined;
  for (const block of blocks) {
    if (isListItem(block)) {
      const ordered = block.type === "numberedListItem";
      const start = block.type === "numberedListItem" ? block.attrs?.start : undefined;
      if (list?.ordered !== ordered || start !== undefined) {
        list = {
          type: "list",
          ordered,
          start: ordered ? (start ?? 1) : null,
          spread: false,
          children: [],
        };
        out.push(list);
      }
      list.children.push(listItem(block, context));
      continue;
    }
    list = undefined;
    out.push(...blockToMdast(block, context));
  }
  return out;
}

function blockToMdast(block: ContentBlock, context: WriteContext): RootContent[] {
  const inline = (inlines: readonly Inline[]): PhrasingContent[] => phrasing(inlines, context);
  switch (block.type) {
    case "paragraph":
      return [
        {
          type: "paragraph",
          children: [...inline(block.content), ...idSuffix(block.id, context)],
        },
      ];
    case "heading":
      return [
        {
          type: "heading",
          depth: block.attrs.level,
          children: [...inline(block.content), ...idSuffix(block.id, context)],
        },
      ];
    case "bulletListItem":
    case "numberedListItem":
    case "taskListItem":
      return blocksToMdast([block], context);
    case "quote":
      return withId(
        block.id,
        [{ type: "blockquote", children: blocksToMdast(block.children, context) as never }],
        context,
      );
    case "callout": {
      const fold = block.attrs.fold === "open" ? "+" : block.attrs.fold === "closed" ? "-" : "";
      const title = inline(trimEdges(block.content));
      const head: PhrasingContent[] = [
        rawInline(`[!${block.attrs.kind}]${fold}`),
        ...(title.length === 0 ? [] : [text(" "), ...title]),
      ];
      const [first, ...rest] = block.children ?? [];
      // The body's first paragraph continues the title's line, as Obsidian writes it.
      const opening: Paragraph =
        first?.type === "paragraph"
          ? {
              type: "paragraph",
              children: [
                ...head,
                text("\n"),
                ...inline(first.content),
                ...idSuffix(first.id, context),
              ],
            }
          : { type: "paragraph", children: head };
      const body = first?.type === "paragraph" ? rest : (block.children ?? []);
      return withId(
        block.id,
        [{ type: "blockquote", children: [opening, ...(blocksToMdast(body, context) as never[])] }],
        context,
      );
    }
    case "toggle":
      return withId(
        block.id,
        [
          html(`<details>\n<summary>${escapeHtml(plainText(block.content))}</summary>`),
          ...blocksToMdast(block.children ?? [], context),
          html("</details>"),
        ],
        context,
      );
    case "code": {
      const [lang = "", ...meta] = block.attrs.language.split(" ");
      return withId(
        block.id,
        [{ type: "code", lang: lang || null, meta: meta.join(" ") || null, value: block.text }],
        context,
      );
    }
    case "math":
      return withId(block.id, [{ type: "math", value: block.text, meta: null }], context);
    case "divider":
      return withId(block.id, [{ type: "thematicBreak" }], context);
    case "table":
      return withId(
        block.id,
        [
          {
            type: "table",
            align: [...block.attrs.align],
            children: block.children.map((row): TableRow => ({
              type: "tableRow",
              children: row.children.map((cell): TableCell => ({
                type: "tableCell",
                children: phrasing(cell.content, context, true),
              })),
            })),
          },
        ],
        context,
      );
    case "columns":
      return withId(
        block.id,
        [
          html("<!-- columns -->"),
          ...block.children.flatMap((column) => [
            html(
              column.attrs === undefined
                ? "<!-- column -->"
                : `<!-- column ${String(Math.round(column.attrs.width * 1000) / 10)}% -->`,
            ),
            ...blocksToMdast(column.children, context),
          ]),
          html("<!-- /columns -->"),
        ],
        context,
      );
    case "image": {
      const { src, alt = "", title, width } = block.attrs;
      return [
        {
          type: "paragraph",
          children: [
            {
              type: "image",
              url: src,
              alt: width === undefined ? alt : `${alt}|${String(width)}`,
              title: title ?? null,
            },
            ...idSuffix(block.id, context),
          ],
        },
      ];
    }
    case "file":
      return [
        {
          type: "paragraph",
          children: [
            { type: "image", url: block.attrs.src, alt: block.attrs.name ?? "", title: null },
            ...idSuffix(block.id, context),
          ],
        },
      ];
    case "bookmark":
      return [
        {
          type: "paragraph",
          children: [rawInline(`<${block.attrs.url}>`), ...idSuffix(block.id, context)],
        },
      ];
    case "embed":
      return [
        {
          type: "paragraph",
          children: [
            {
              type: "wikiLink",
              embed: true,
              value: wikiLinkText(block.attrs.target, block.attrs.alias, context.noteTitle),
            } satisfies WikiLinkNode,
            ...idSuffix(block.id, context),
          ],
        },
      ];
    case "database":
      return [
        {
          type: "paragraph",
          children: [
            {
              type: "wikiLink",
              embed: true,
              value: context.noteTitle(block.attrs.database) ?? block.attrs.database,
            } satisfies WikiLinkNode,
            ...idSuffix(block.id, context),
          ],
        },
      ];
    case "raw":
      return withId(
        block.id,
        [{ type: "rawBlock", value: block.text } satisfies RawBlockNode],
        context,
      );
    default: {
      // A plugin's block, as a code block named by its type that holds its data as JSON.
      const { id, type, ...data } = block;
      return withId(
        id,
        [{ type: "code", lang: type, meta: null, value: JSON.stringify(data, null, 2) }],
        context,
      );
    }
  }
}

const verbatim = (node: { value: string }): string => node.value;

/** In a table cell a pipe ends the cell, so math and comments there escape theirs, as GFM reads `\|`. */
function pipes(value: string, state: State): string {
  return state.stack.includes("tableCell") ? value.replace(/\|/g, "\\|") : value;
}

/** A dollar inside inline math would end it, so it is written as TeX's escaped dollar, `\$`. */
function escapeDollars(latex: string): string {
  let out = "";
  let backslashes = 0;
  for (const char of latex) {
    if (char === "$" && backslashes % 2 === 0) out += "\\";
    backslashes = char === "\\" ? backslashes + 1 : 0;
    out += char;
  }
  return out;
}

const bareLinks = new Map<string, boolean>();

/** Whether `text` alone reads back as a GFM autolink to `url`, as `https://example.com` does. */
function readsAsLink(text: string, url: string): boolean {
  const key = `${text}
${url}`;
  let result = bareLinks.get(key);
  if (result === undefined) {
    const [paragraph] = markdownToTree(text).children;
    const [link, ...rest] = paragraph?.type === "paragraph" ? paragraph.children : [];
    const [label] = link?.type === "link" ? link.children : [];
    result =
      rest.length === 0 &&
      link?.type === "link" &&
      link.url === url &&
      link.children.length === 1 &&
      label?.type === "text" &&
      label.value === text;
    if (bareLinks.size > 1000) bareLinks.clear();
    bareLinks.set(key, result);
  }
  return result;
}

/**
 * Escapes every `=` of text that stands next to another `=`, in the text or
 * just around it, so no two read as a highlight's marker. This is not left
 * to `unsafe` patterns: mdast-util-to-markdown skips escaping a character
 * next to one it escapes anyway, even when that neighbour lies outside the
 * text, such as the `==` of the highlight the text is in.
 */
function breakEqualsRuns(value: string, before: string, after: string): string {
  const whole = before + value + after;
  const escaped = (at: number): boolean => {
    let backslashes = 0;
    while (at - backslashes - 1 >= 0 && whole[at - backslashes - 1] === "\\") backslashes++;
    return backslashes % 2 === 1;
  };
  const equals = (at: number): boolean => whole[at] === "=" && !escaped(at);
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const at = before.length + index;
    if (equals(at) && (equals(at - 1) || equals(at + 1))) out += "\\";
    out += value.charAt(index);
  }
  return out;
}

const handlers: Partial<Record<string, Handle>> = {
  text(node: Text, parent, state, info) {
    return breakEqualsRuns(
      defaultHandlers.text(node, parent, state, info),
      info.before,
      info.after,
    );
  },
  link(node: Link, parent, state, info) {
    // A link whose text is its URL is written as the bare URL, as it was most likely typed.
    const [label] = node.children;
    if (!node.title && node.children.length === 1 && label?.type === "text") {
      const alone = parent?.type === "paragraph" && parent.children.length === 1;
      if (readsAsLink(label.value, node.url) && /^$|^[\s.,;:!?)]/.test(info.after)) {
        return label.value;
      }
      // `<url>` alone in a paragraph reads as a bookmark, so it is kept for other places.
      if (!alone && label.value === node.url && /^[a-z][a-z0-9+.-]*:[^\s<>]*$/i.test(node.url)) {
        return `<${node.url}>`;
      }
    }
    return defaultHandlers.link(node, parent, state, info);
  },
  wikiLink(node: WikiLinkNode, _parent, state) {
    // In a table cell, the pipe before an alias is escaped, as Obsidian writes it.
    const value = state.stack.includes("tableCell") ? node.value.replace("|", "\\|") : node.value;
    return `${node.embed ? "!" : ""}[[${value}]]`;
  },
  tag(node: TagNode) {
    return `#${node.value}`;
  },
  // Highlights and strikethrough pair as whole runs of two markers, as
  // Obsidian reads them. Through `attention`, `containerPhrasing` picks the
  // sequences and encodes what stands at their edges, as it does for bold.
  highlight: Object.assign(
    (node: HighlightNode, _parent: unknown, state: State, info: Info): string => {
      const exit = state.enter("highlight");
      const value = state.containerPhrasing(node, { ...info, before: "=", after: "=" });
      exit();
      return `==${value}==`;
    },
    {
      attention: (): AttentionInfo => ({ construct: "highlight", markers: ["="], sizes: [2] }),
      peek: () => "=",
    },
  ),
  delete: Object.assign(
    (node: Delete, _parent: unknown, state: State, info: Info): string => {
      const exit = state.enter("strikethrough");
      const value = state.containerPhrasing(node, { ...info, before: "~", after: "~" });
      exit();
      return `~~${value}~~`;
    },
    {
      attention: (): AttentionInfo => ({ construct: "strikethrough", markers: ["~"], sizes: [2] }),
      peek: () => "~",
    },
  ),
  underline(node: UnderlineNode, _parent, state, info) {
    const exit = state.enter("underline");
    const value = state.containerPhrasing(node, { ...info, before: ">", after: "<" });
    exit();
    // `<u>` that ends its line would start an HTML block: that line break is encoded.
    return `<u>${value.replace(/^\r?\n/, "&#xA;")}</u>`;
  },
  obsidianComment(node: CommentNode, _parent, state) {
    return `%%${pipes(node.value, state)}%%`;
  },
  inlineMath(node: { value: string }, _parent, state) {
    return `$${pipes(escapeDollars(node.value), state)}$`;
  },
  rawInline: verbatim,
  rawBlock: verbatim,
  commentBlock: verbatim,
};

// What text escapes so that it does not read as Obsidian's syntax. A
// `before` that consumed its character would hide a match right after it,
// so these look behind and ahead instead. Runs of `=` are broken up in the
// text handler, `breakEqualsRuns`.
const unsafe: Unsafe[] = [
  // `#tag`, wherever it stands: a `#` with a condition on the character before
  // it is skipped when that one is escaped, as the `|` around a table cell.
  { character: "#", after: "(?=[^\\s#])", inConstruct: "phrasing" },
  // `%%comment%%`.
  { character: "%", after: "(?=%)", inConstruct: "phrasing" },
  // `$math$`: mdast-util-math leaves dollars in text as they are.
  { character: "$", inConstruct: "phrasing" },
  // A backslash before a letter, a digit or a line ending. mdast-util-to-markdown
  // escapes one before punctuation itself, and one before a space it encodes;
  // next to bold or italic it may encode the character after a backslash and
  // drop the backslash of `\a`; and one before a line ending makes a hard break.
  { character: "\\", after: "(?=[^!-/:-@[-`{-~ \\t])", inConstruct: "phrasing" },
  // `^id` at the end of a block.
  { character: "^", before: "(?<=^|\\s)", after: "(?=[A-Za-z0-9-])", inConstruct: "phrasing" },
];

function otherBullet(bullet: Style["bullet"]): Style["bullet"] {
  return bullet === "-" ? "*" : "-";
}

export interface FreshOptions {
  /** The bullet of the list item before, so a new item stays in its list. */
  readonly bullet?: Style["bullet"];
  readonly bulletOrdered?: "." | ")";
  readonly rule?: Style["rule"];
}

/** Writes mdast nodes as Markdown, without the final line ending. */
export function write(
  nodes: RootContent[],
  context: WriteContext,
  fresh: FreshOptions = {},
): string {
  const bullet = fresh.bullet ?? context.style.bullet;
  const options: Options = {
    bullet,
    bulletOther: otherBullet(bullet),
    bulletOrdered: fresh.bulletOrdered ?? ".",
    emphasis: context.style.emphasis,
    strong: context.style.strong,
    fence: context.style.fence,
    rule: fresh.rule ?? context.style.rule,
    listItemIndent: "one",
    incrementListMarker: true,
    resourceLink: true,
    handlers,
    unsafe,
    extensions: [gfmToMarkdown(), mathToMarkdown()],
  };
  const root: Root = { type: "root", children: nodes };
  return toMarkdown(root, options).replace(/\n$/, "");
}

/** A single list item, numbered `number` when it is in a numbered list. */
export function writeListItem(
  block: ListItemBlock,
  number: number,
  context: WriteContext,
  fresh: FreshOptions = {},
): string {
  const ordered = block.type === "numberedListItem";
  const list: List = {
    type: "list",
    ordered,
    start: ordered ? number : null,
    spread: false,
    children: [listItem(block, context)],
  };
  return write([list], context, fresh);
}
