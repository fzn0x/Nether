// Markdown to a note: the syntax tree mapped to Nether's blocks and inlines,
// with a source map of the top-level blocks for the round trip.
import {
  type BlockId,
  type ContentBlock,
  type Inline,
  type LinkTarget,
  type Mark,
  type PropertyEntry,
  type Table,
  type TableRow,
  isBlockId,
  isTagName,
  markTypes,
  newBlockId,
  readContent,
} from "@nether/core";
import type {
  Blockquote,
  Code,
  Html,
  Image,
  List,
  ListItem,
  Node,
  Paragraph,
  PhrasingContent,
  RootContent,
  TableRow as MdastTableRow,
} from "mdast";
import { readFrontmatter } from "./frontmatter.ts";
import type { UnderlineNode } from "./mdast.ts";
import {
  type Source,
  type SourceBlock,
  type SourceFrontmatter,
  type Style,
  defaultStyle,
  fingerprint,
} from "./source.ts";
import { markdownToTree } from "./tree.ts";

export interface ParseOptions {
  /** Makes the ID of a block the file gives none; a random one by default. */
  readonly newId?: (taken: ReadonlySet<string>) => BlockId;
}

/** A note as Markdown holds it: properties from the frontmatter, and content. */
export interface MarkdownNote {
  readonly properties: readonly PropertyEntry[];
  readonly content: readonly ContentBlock[];
}

export interface ParsedMarkdown extends MarkdownNote {
  /** The block IDs the file writes as `^id`. */
  readonly writtenIds: ReadonlySet<BlockId>;
  /** Why the frontmatter could not be read, when it could not: its properties then cannot change. */
  readonly frontmatterError?: string;
  /** What `serialize` needs to keep the bytes of unchanged blocks. */
  readonly source: Source;
}

const fileExtensions = /\.(pdf|mp3|wav|m4a|ogg|oga|flac|aac|webm|mp4|m4v|mov|mkv|ogv|3gp)$/i;
const idSuffix = /(^|[ \t]+)\^([A-Za-z0-9-]+)$/;
const pluginType = /^[a-z][a-z0-9-]*\/[a-z][a-zA-Z0-9-]*$/;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Span {
  start: number;
  end: number;
  idWritten: boolean;
}

/** Parses a wiki link's text, `target#heading|alias`, into its target and alias. */
export function parseWikiLink(text: string): { target: LinkTarget; alias?: string } | undefined {
  const separator = /\\?\|/.exec(text);
  const path = separator === null ? text : text.slice(0, separator.index);
  const alias = separator === null ? undefined : text.slice(separator.index + separator[0].length);
  if (alias?.trim() === "") return undefined;
  let title = path;
  let narrow: { heading?: string; block?: BlockId } = {};
  const hash = path.indexOf("#");
  if (hash !== -1) {
    title = path.slice(0, hash);
    const rest = path.slice(hash + 1);
    if (rest.startsWith("^")) {
      if (!isBlockId(rest.slice(1))) return undefined;
      narrow = { block: rest.slice(1) as BlockId };
    } else {
      if (rest.trim() === "") return undefined;
      narrow = { heading: rest };
    }
  } else {
    const caret = /\^([A-Za-z0-9-]+)$/.exec(path);
    if (caret !== null && caret.index > 0) {
      title = path.slice(0, caret.index);
      narrow = { block: caret[1] as BlockId };
    }
  }
  let target: LinkTarget;
  if (title.trim() !== "") target = { title, ...narrow };
  else if (narrow.heading !== undefined) target = { heading: narrow.heading };
  else if (narrow.block !== undefined) target = { block: narrow.block };
  else return undefined;
  return alias === undefined ? { target } : { target, alias };
}

function sameMark(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  if (a.type !== "link" || b.type !== "link") return true;
  return a.href === b.href && a.title === b.title;
}

function sameMarks(a: readonly Mark[] = [], b: readonly Mark[] = []): boolean {
  return (
    a.length === b.length &&
    a.every((mark, index) => {
      const other = b[index];
      return other !== undefined && sameMark(mark, other);
    })
  );
}

function addMark(marks: readonly Mark[], mark: Mark): readonly Mark[] {
  if (marks.some((other) => other.type === mark.type)) return marks;
  return [...marks, mark].sort((a, b) => markTypes.indexOf(a.type) - markTypes.indexOf(b.type));
}

function marked<T extends object>(inline: T, marks: readonly Mark[]): T {
  return marks.length === 0 ? inline : { ...inline, marks };
}

/** Pairs `<u>` and `</u>` among siblings into underline nodes. */
function underlines(nodes: readonly PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node === undefined) continue;
    if (node.type === "html" && /^<u>$/i.test(node.value)) {
      const close = nodes.findIndex(
        (other, at) => at > index && other.type === "html" && /^<\/u>$/i.test(other.value),
      );
      if (close !== -1) {
        const underline: UnderlineNode = {
          type: "underline",
          children: underlines(nodes.slice(index + 1, close)),
        };
        out.push(underline);
        index = close;
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

function detectStyle(text: string, nodes: readonly RootContent[]): Style {
  const style: Mutable<Style> = { ...defaultStyle };
  const seen = new Set<string>();
  const at = (node: Node): string => text.charAt(node.position?.start.offset ?? -1);
  const visit = (node: RootContent): void => {
    if (node.type === "listItem" && !seen.has("bullet")) {
      const char = at(node);
      if (char === "-" || char === "*" || char === "+") {
        style.bullet = char;
        seen.add("bullet");
      }
    } else if (node.type === "emphasis" && !seen.has("emphasis")) {
      const char = at(node);
      if (char === "*" || char === "_") style.emphasis = char;
      seen.add("emphasis");
    } else if (node.type === "strong" && !seen.has("strong")) {
      const char = at(node);
      if (char === "*" || char === "_") style.strong = char;
      seen.add("strong");
    } else if (node.type === "code" && !seen.has("fence")) {
      const char = at(node);
      if (char === "`" || char === "~") {
        style.fence = char;
        seen.add("fence");
      }
    } else if (node.type === "thematicBreak" && !seen.has("rule")) {
      const char = at(node);
      if (char === "-" || char === "*" || char === "_") style.rule = char;
      seen.add("rule");
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return style;
}

class Converter {
  readonly written = new Set<BlockId>();
  private readonly taken = new Set<string>();
  private readonly avoid: Set<string>;
  private readonly definitions = new Map<string, { url: string; title?: string }>();
  /** Whether inline content being read is in a table cell, where `<br>` is a line break. */
  private inCell = false;
  private readonly text: string;
  private readonly newId: (taken: ReadonlySet<string>) => BlockId;

  constructor(text: string, newId: (taken: ReadonlySet<string>) => BlockId) {
    this.text = text;
    this.newId = newId;
    // Every `^word` in the file might be an ID: new IDs keep clear of them.
    this.avoid = new Set([...text.matchAll(/\^([A-Za-z0-9-]+)/g)].map((match) => match[1] ?? ""));
  }

  define(nodes: readonly RootContent[]): void {
    for (const node of nodes) {
      if (node.type === "definition" && !this.definitions.has(node.identifier)) {
        this.definitions.set(node.identifier, {
          url: node.url,
          ...(node.title ? { title: node.title } : {}),
        });
      }
      if ("children" in node) this.define(node.children);
    }
  }

  private slice(node: Node): string {
    return this.text.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
  }

  /** An ID for a new block: the one the file wrote, if it can be used, or a new one. */
  private id(written?: string): BlockId {
    if (written !== undefined && isBlockId(written) && !this.taken.has(written)) {
      this.taken.add(written);
      this.avoid.add(written);
      this.written.add(written as BlockId);
      return written as BlockId;
    }
    const id = this.newId(this.avoid);
    this.taken.add(id);
    this.avoid.add(id);
    return id;
  }

  // Inline content.

  inlines(nodes: readonly PhrasingContent[], marks: readonly Mark[] = []): Inline[] {
    const out: Inline[] = [];
    const push = (inline: Inline): void => {
      const last = out[out.length - 1];
      if (inline.type === "text" && last?.type === "text" && sameMarks(last.marks, inline.marks)) {
        out[out.length - 1] = { ...last, text: last.text + inline.text };
      } else {
        out.push(inline);
      }
    };
    const raw = (node: Node, value = this.slice(node)): void => {
      if (value.trim() !== "") push(marked({ type: "raw", markdown: value }, marks));
      else if (value !== "") push(marked({ type: "text", text: value }, marks));
    };
    for (const node of underlines(nodes)) {
      switch (node.type) {
        case "text":
          if (node.value !== "") push(marked({ type: "text", text: node.value }, marks));
          break;
        case "strong":
          for (const inline of this.inlines(node.children, addMark(marks, { type: "bold" })))
            push(inline);
          break;
        case "emphasis":
          for (const inline of this.inlines(node.children, addMark(marks, { type: "italic" })))
            push(inline);
          break;
        case "delete":
          for (const inline of this.inlines(node.children, addMark(marks, { type: "strike" })))
            push(inline);
          break;
        case "highlight":
          for (const inline of this.inlines(node.children, addMark(marks, { type: "highlight" })))
            push(inline);
          break;
        case "underline":
          for (const inline of this.inlines(node.children, addMark(marks, { type: "underline" })))
            push(inline);
          break;
        case "inlineCode":
          if (node.value === "") raw(node);
          else push({ type: "text", text: node.value, marks: addMark(marks, { type: "code" }) });
          break;
        case "obsidianComment":
          if (node.value === "") raw(node);
          else push({ type: "text", text: node.value, marks: addMark(marks, { type: "comment" }) });
          break;
        case "link":
        case "linkReference": {
          const definition =
            node.type === "link"
              ? { url: node.url, ...(node.title ? { title: node.title } : {}) }
              : this.definitions.get(node.identifier);
          if (
            definition === undefined ||
            node.children.length === 0 ||
            definition.url.trim() === "" ||
            /[\r\n]/.test(definition.url)
          ) {
            raw(node);
            break;
          }
          const link: Mark = {
            type: "link",
            href: definition.url,
            ...(definition.title === undefined ? {} : { title: definition.title }),
          };
          for (const inline of this.inlines(node.children, addMark(marks, link))) push(inline);
          break;
        }
        case "break":
          push({ type: "hardBreak" });
          break;
        case "wikiLink": {
          const link = node.embed ? undefined : parseWikiLink(node.value);
          if (link === undefined) raw(node);
          else push(marked({ type: "wikiLink", ...link }, marks));
          break;
        }
        case "tag":
          if (isTagName(node.value)) push(marked({ type: "tag", name: node.value }, marks));
          else raw(node);
          break;
        case "inlineMath":
          if (node.value.trim() === "") raw(node);
          else push(marked({ type: "math", latex: node.value }, marks));
          break;
        case "rawInline":
          raw(node, node.value);
          break;
        case "html":
          if (this.inCell && /^<br\s*\/?>$/i.test(node.value)) push({ type: "hardBreak" });
          else raw(node, node.value);
          break;
        default:
          raw(node);
      }
    }
    return out;
  }

  /** Takes an Obsidian block ID, ` ^id`, off the end of a block's inline content. */
  private takeId(inlines: Inline[], container: Node): string | undefined {
    const last = inlines[inlines.length - 1];
    if (last?.type !== "text" || last.marks !== undefined) return undefined;
    const match = idSuffix.exec(last.text);
    if (match === null) return undefined;
    // Without a space before it, `^id` is an ID only as the whole block: `[a](b)^c` is text.
    if (match[1] === "" && inlines.length > 1) return undefined;
    // An escaped caret, `\^id`, is text.
    const end = container.position?.end.offset ?? 0;
    const id = match[2] ?? "";
    if (this.text.slice(end - id.length - 1, end) !== `^${id}`) return undefined;
    if (this.text.charAt(end - id.length - 2) === "\\") return undefined;
    const rest = last.text.slice(0, match.index);
    if (rest === "") inlines.pop();
    else inlines[inlines.length - 1] = { ...last, text: rest };
    return id;
  }

  /** The ID a paragraph of only `^id` gives the block before it. */
  private standaloneId(node: RootContent): string | undefined {
    if (node.type !== "paragraph" || node.children.length !== 1) return undefined;
    const [child] = node.children;
    if (child?.type !== "text") return undefined;
    const match = /^\^([A-Za-z0-9-]+)$/.exec(this.slice(node));
    return match?.[1];
  }

  // Blocks.

  /** Converts sibling nodes; for the top level, `spans` gets where each block stands. */
  blocks(nodes: readonly RootContent[], spans?: Span[]): ContentBlock[] {
    const out: ContentBlock[] = [];
    const add = (block: ContentBlock, node: Node, idWritten: boolean, end?: Node): void => {
      out.push(block);
      spans?.push({
        start: node.position?.start.offset ?? 0,
        end: (end ?? node).position?.end.offset ?? 0,
        idWritten,
      });
    };
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node === undefined || node.type === "yaml") continue;

      const standalone = this.standaloneId(node);
      const previous = out[out.length - 1];
      if (
        standalone !== undefined &&
        previous !== undefined &&
        !this.written.has(previous.id) &&
        isBlockId(standalone) &&
        !this.taken.has(standalone)
      ) {
        // A block that cannot end in `^id`, as a table, takes its ID from the line after it.
        this.taken.add(standalone);
        this.avoid.add(standalone);
        this.written.add(standalone as BlockId);
        (previous as Mutable<ContentBlock>).id = standalone as BlockId;
        const span = spans?.[spans.length - 1];
        if (span !== undefined) {
          span.end = node.position?.end.offset ?? span.end;
          span.idWritten = true;
        }
        continue;
      }

      if (node.type === "html") {
        const group = this.htmlGroup(nodes, index);
        if (group !== undefined) {
          add(group.block, node, false, nodes[group.end]);
          index = group.end;
          continue;
        }
      }

      if (node.type === "list") {
        node.children.forEach((item, at) => {
          const block = this.listItem(item, node, at);
          add(block, item, this.written.has(block.id));
        });
        continue;
      }

      const block = this.block(node, spans !== undefined);
      if (block !== undefined) add(block, node, this.written.has(block.id));
    }
    return out;
  }

  private block(node: RootContent, top: boolean): ContentBlock | undefined {
    switch (node.type) {
      case "paragraph":
        return this.paragraph(node);
      case "heading": {
        const content = this.inlines(node.children);
        const written = this.takeId(content, node);
        return {
          id: this.id(written),
          type: "heading",
          attrs: { level: node.depth },
          content,
        };
      }
      case "thematicBreak":
        return { id: this.id(), type: "divider" };
      case "blockquote":
        return (
          this.callout(node) ?? {
            id: this.id(),
            type: "quote",
            children: this.blocks(node.children),
          }
        );
      case "code":
        return this.code(node);
      case "math":
        return { id: this.id(), type: "math", text: node.value };
      case "table":
        return this.table(node.align ?? [], node.children);
      case "list":
        // Lists are split into their items by `blocks`.
        return undefined;
      case "html":
      case "commentBlock":
        return { id: this.id(), type: "raw", text: top ? this.slice(node) : node.value };
      default:
        return { id: this.id(), type: "raw", text: this.slice(node) };
    }
  }

  private paragraph(node: Paragraph): ContentBlock {
    // A paragraph of one image, embed or autolink, maybe with `^id` after it, is a block of its own.
    const children = [...node.children];
    const tail = children[children.length - 1];
    let written: string | undefined;
    if (children.length === 2 && tail?.type === "text") {
      const match = /^[ \t]+\^([A-Za-z0-9-]+)$/.exec(tail.value);
      if (
        match !== null &&
        this.text.slice(tail.position?.start.offset ?? 0).startsWith(tail.value)
      ) {
        written = match[1];
        children.pop();
      }
    }
    const only = children.length === 1 ? children[0] : undefined;
    if (only?.type === "image") {
      return this.image(only, written);
    }
    if (only?.type === "wikiLink" && only.embed) {
      const link = parseWikiLink(only.value);
      if (link !== undefined) {
        return {
          id: this.id(written),
          type: "embed",
          attrs: link.alias === undefined ? { target: link.target } : link,
        };
      }
    }
    if (
      only?.type === "link" &&
      this.slice(only).startsWith("<") &&
      /^https?:\/\/\S+$/.test(only.url)
    ) {
      return { id: this.id(written), type: "bookmark", attrs: { url: only.url } };
    }
    const content = this.inlines(node.children);
    const id = this.takeId(content, node);
    return { id: this.id(id), type: "paragraph", content };
  }

  private image(node: Image, written: string | undefined): ContentBlock {
    if (fileExtensions.test(node.url.split(/[?#]/)[0] ?? "")) {
      return {
        id: this.id(written),
        type: "file",
        attrs: { src: node.url, ...(node.alt?.trim() ? { name: node.alt } : {}) },
      };
    }
    let alt = node.alt ?? "";
    let width: number | undefined;
    const size = /^(.*)\|(\d{1,5})$/.exec(alt);
    if (size !== null) {
      alt = size[1] ?? "";
      width = Number(size[2]);
      if (width < 1) {
        alt = node.alt ?? "";
        width = undefined;
      }
    }
    return {
      id: this.id(written),
      type: "image",
      attrs: {
        src: node.url,
        ...(alt === "" ? {} : { alt }),
        ...(node.title ? { title: node.title } : {}),
        ...(width === undefined ? {} : { width }),
      },
    };
  }

  private code(node: Code): ContentBlock {
    const language = [node.lang, node.meta].filter(Boolean).join(" ");
    if (node.lang && pluginType.test(node.lang) && !node.meta) {
      try {
        const data: unknown = JSON.parse(node.value);
        const [block] = readContent([{ ...(data as object), id: "x", type: node.lang }], "plugin");
        if (block !== undefined) return { ...block, id: this.id() };
      } catch {
        // Not a plugin block after all: plain code.
      }
    }
    return { id: this.id(), type: "code", attrs: { language }, text: node.value };
  }

  private table(
    align: readonly ("left" | "right" | "center" | null)[],
    rows: readonly MdastTableRow[],
  ): Table {
    const columns = Math.max(align.length, ...rows.map((row) => row.children.length), 1);
    const children: TableRow[] = rows.map((row) => ({
      id: this.id(),
      type: "tableRow",
      children: Array.from({ length: columns }, (_, at) => {
        const cell = row.children[at];
        return {
          id: this.id(),
          type: "tableCell" as const,
          content: cell === undefined ? [] : this.cell(cell.children),
        };
      }),
    }));
    return {
      id: this.id(),
      type: "table",
      attrs: {
        header: true,
        align: Array.from({ length: columns }, (_, at) => align[at] ?? null),
      },
      children,
    };
  }

  private cell(nodes: readonly PhrasingContent[]): Inline[] {
    this.inCell = true;
    try {
      return this.inlines(nodes);
    } finally {
      this.inCell = false;
    }
  }

  private listItem(item: ListItem, list: List, index: number): ContentBlock {
    const [first, ...rest] = item.children;
    let content: Inline[] = [];
    let written: string | undefined;
    let nested = item.children;
    if (first?.type === "paragraph") {
      content = this.inlines(first.children);
      written = this.takeId(content, first);
      nested = rest;
    }
    const id = this.id(written);
    const children = this.blocks(nested);
    const base = { id, content, ...(children.length === 0 ? {} : { children }) };
    if (typeof item.checked === "boolean") {
      return { ...base, type: "taskListItem", attrs: { checked: item.checked } };
    }
    if (list.ordered === true) {
      const start = list.start ?? 1;
      return index === 0 && start !== 1
        ? { ...base, type: "numberedListItem", attrs: { start } }
        : { ...base, type: "numberedListItem" };
    }
    return { ...base, type: "bulletListItem" };
  }

  /** A blockquote that starts with `[!kind]`, as Obsidian writes callouts. */
  private callout(node: Blockquote): ContentBlock | undefined {
    const [first, ...rest] = node.children;
    if (first?.type !== "paragraph") return undefined;
    const line = this.slice(first).split(/\r?\n/, 1)[0] ?? "";
    const marker = /^\[!([A-Za-z][A-Za-z0-9-]*)\]([+-]?)[ \t]*/.exec(line);
    if (marker === null) return undefined;
    const inlines = this.inlines(first.children);
    const head = inlines[0];
    if (head?.type !== "text" || head.marks !== undefined || !head.text.startsWith(marker[0])) {
      return undefined;
    }
    const afterMarker = head.text.slice(marker[0].length);
    if (afterMarker === "") inlines.shift();
    else inlines[0] = { ...head, text: afterMarker };

    // The title is the rest of the first line; the lines after it start the body.
    const title: Inline[] = [];
    const body: Inline[] = [];
    let inBody = false;
    for (const inline of inlines) {
      if (inBody) {
        body.push(inline);
      } else if (inline.type === "text" && inline.text.includes("\n")) {
        const at = inline.text.indexOf("\n");
        const before = inline.text.slice(0, at).trimEnd();
        const after = inline.text.slice(at + 1);
        if (before !== "") title.push({ ...inline, text: before });
        if (after !== "") body.push({ ...inline, text: after });
        inBody = true;
      } else {
        title.push(inline);
      }
    }
    const children: ContentBlock[] = [];
    if (body.length > 0) {
      const written = this.takeId(body, first);
      children.push({ id: this.id(written), type: "paragraph", content: body });
    }
    children.push(...this.blocks(rest));
    const fold = marker[2] === "+" ? "open" : marker[2] === "-" ? "closed" : undefined;
    return {
      id: this.id(),
      type: "callout",
      attrs: {
        kind: (marker[1] ?? "note").toLowerCase(),
        ...(fold === undefined ? {} : { fold }),
      },
      content: title,
      ...(children.length === 0 ? {} : { children }),
    };
  }

  /**
   * Blocks Nether writes between HTML markers, which other apps show as
   * their contents: columns between `<!-- columns -->` and `<!-- /columns -->`,
   * and toggles as `<details>` with a `<summary>`.
   */
  private htmlGroup(
    nodes: readonly RootContent[],
    index: number,
  ): { block: ContentBlock; end: number } | undefined {
    const node = nodes[index] as Html;
    const isHtml = (other: RootContent | undefined, pattern: RegExp): other is Html =>
      other?.type === "html" && pattern.test(other.value.trim());
    const findClose = (open: RegExp, close: RegExp): number => {
      let depth = 0;
      for (let at = index + 1; at < nodes.length; at++) {
        const other = nodes[at];
        if (isHtml(other, open)) depth++;
        else if (isHtml(other, close)) {
          if (depth === 0) return at;
          depth--;
        }
      }
      return -1;
    };

    if (/^<!--\s*columns\s*-->$/.test(node.value.trim())) {
      const end = findClose(/^<!--\s*columns\s*-->$/, /^<!--\s*\/columns\s*-->$/);
      if (end === -1) return undefined;
      const columnMarker = /^<!--\s*column(?:\s+(\d{1,3}(?:\.\d+)?)%)?\s*-->$/;
      const columns: { width?: number; nodes: RootContent[] }[] = [];
      let depth = 0;
      for (let at = index + 1; at < end; at++) {
        const other = nodes[at];
        if (other === undefined) continue;
        if (isHtml(other, /^<!--\s*columns\s*-->$/)) depth++;
        if (isHtml(other, /^<!--\s*\/columns\s*-->$/)) depth--;
        const marker =
          depth === 0 && other.type === "html" ? columnMarker.exec(other.value.trim()) : null;
        if (marker !== null) {
          const percent = marker[1] === undefined ? undefined : Number(marker[1]);
          columns.push({
            ...(percent !== undefined && percent > 0 && percent <= 100
              ? { width: Number((percent / 100).toPrecision(12)) }
              : {}),
            nodes: [],
          });
        } else if (columns.length === 0) {
          return undefined;
        } else {
          columns[columns.length - 1]?.nodes.push(other);
        }
      }
      if (columns.length < 2) return undefined;
      return {
        block: {
          id: this.id(),
          type: "columns",
          children: columns.map((column) => ({
            id: this.id(),
            type: "column" as const,
            ...(column.width === undefined ? {} : { attrs: { width: column.width } }),
            children: this.blocks(column.nodes),
          })),
        },
        end,
      };
    }

    const details = /^<details>\s*<summary>([^<]*)<\/summary>$/i.exec(node.value.trim());
    if (details !== null) {
      const end = findClose(/^<details\b/i, /^<\/details>$/i);
      if (end === -1) return undefined;
      const summary = decodeHtml(details[1] ?? "").trim();
      const children = this.blocks(nodes.slice(index + 1, end));
      return {
        block: {
          id: this.id(),
          type: "toggle",
          content: summary === "" ? [] : [{ type: "text", text: summary }],
          ...(children.length === 0 ? {} : { children }),
        },
        end,
      };
    }
    return undefined;
  }
}

function decodeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Parses a Markdown file into a note's properties and content. */
export function parseMarkdown(markdown: string, options: ParseOptions = {}): ParsedMarkdown {
  const bom = markdown.startsWith("﻿");
  const text = bom ? markdown.slice(1) : markdown;
  const tree = markdownToTree(text);
  const converter = new Converter(text, options.newId ?? newBlockId);
  converter.define(tree.children);

  let frontmatter: SourceFrontmatter | undefined;
  const [first] = tree.children;
  if (first?.type === "yaml") {
    const read = readFrontmatter(first.value);
    frontmatter = {
      start: first.position?.start.offset ?? 0,
      end: first.position?.end.offset ?? 0,
      yaml: first.value,
      properties: read.properties,
      ...(read.error === undefined ? {} : { error: read.error }),
    };
  }

  const spans: Span[] = [];
  const content = converter.blocks(tree.children, spans);
  const blocks: SourceBlock[] = content.map((block, index) => {
    const span = spans[index] ?? { start: 0, end: 0, idWritten: false };
    return {
      id: block.id,
      fingerprint: fingerprint(block),
      start: span.start,
      end: span.end,
      idWritten: span.idWritten,
    };
  });

  return {
    properties: frontmatter?.properties ?? [],
    content,
    writtenIds: converter.written,
    ...(frontmatter?.error === undefined ? {} : { frontmatterError: frontmatter.error }),
    source: {
      text,
      bom,
      eol: text.includes("\r\n") ? "\r\n" : "\n",
      style: detectStyle(text, tree.children),
      ...(frontmatter === undefined ? {} : { frontmatter }),
      blocks,
    },
  };
}
