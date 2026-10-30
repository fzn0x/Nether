// A note's content: a tree of blocks, each with a stable ID, holding inline
// content (text with marks, links, tags, math) and nested blocks.
import {
  type BlockId,
  type NoteId,
  type ViewId,
  readBlockId,
  readNoteId,
  readViewId,
} from "./ids.ts";
import { type JsonObject, readJsonObject } from "./json.ts";
import {
  fail,
  readArray,
  readBoolean,
  readFields,
  readInteger,
  readLine,
  readName,
  readNumber,
  readOneOf,
  readOptional,
  readString,
  readText,
} from "./read.ts";

/**
 * Where a link points: an existing note, or a title no note has yet, either
 * of which may narrow to a heading or a block; or a heading or a block of
 * the note the link is in, as Obsidian's `[[#Heading]]`.
 */
export type LinkTarget =
  | { readonly note: NoteId; readonly heading?: string; readonly block?: BlockId }
  | { readonly title: string; readonly heading?: string; readonly block?: BlockId }
  | { readonly heading: string }
  | { readonly block: BlockId };

export const markTypes = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "highlight",
  "comment",
  "link",
] as const;

export type MarkType = (typeof markTypes)[number];

export type Mark =
  | { readonly type: Exclude<MarkType, "link"> }
  | { readonly type: "link"; readonly href: string; readonly title?: string };

interface Marked {
  /** The formatting over this piece, such as bold around a link: `**[[Note]]**`. */
  readonly marks?: readonly Mark[];
}

/** Inline content: what a line of text is made of. */
export type Inline =
  | ({ readonly type: "text"; readonly text: string } & Marked)
  | { readonly type: "hardBreak" }
  | ({ readonly type: "wikiLink"; readonly target: LinkTarget; readonly alias?: string } & Marked)
  | ({ readonly type: "tag"; readonly name: string } & Marked)
  | ({ readonly type: "math"; readonly latex: string } & Marked)
  | ({ readonly type: "raw"; readonly markdown: string } & Marked);

interface BlockBase<Type extends string> {
  readonly id: BlockId;
  readonly type: Type;
}

export interface Paragraph extends BlockBase<"paragraph"> {
  readonly content: readonly Inline[];
}

export interface Heading extends BlockBase<"heading"> {
  readonly attrs: { readonly level: 1 | 2 | 3 | 4 | 5 | 6 };
  readonly content: readonly Inline[];
}

export interface BulletListItem extends BlockBase<"bulletListItem"> {
  readonly content: readonly Inline[];
  readonly children?: readonly ContentBlock[];
}

export interface NumberedListItem extends BlockBase<"numberedListItem"> {
  /** The number the list starts at, when it is not 1; set on the first item. */
  readonly attrs?: { readonly start: number };
  readonly content: readonly Inline[];
  readonly children?: readonly ContentBlock[];
}

export interface TaskListItem extends BlockBase<"taskListItem"> {
  readonly attrs: { readonly checked: boolean };
  readonly content: readonly Inline[];
  readonly children?: readonly ContentBlock[];
}

export interface Quote extends BlockBase<"quote"> {
  readonly children: readonly ContentBlock[];
}

/** A callout, as Obsidian writes `> [!note] Title`: its content is the title, its children the body. */
export interface Callout extends BlockBase<"callout"> {
  readonly attrs: { readonly kind: string; readonly fold?: "open" | "closed" };
  readonly content: readonly Inline[];
  readonly children?: readonly ContentBlock[];
}

/** A toggle: its content is the summary, its children what it shows when open. */
export interface Toggle extends BlockBase<"toggle"> {
  readonly content: readonly Inline[];
  readonly children?: readonly ContentBlock[];
}

export interface CodeBlock extends BlockBase<"code"> {
  readonly attrs: { readonly language: string };
  readonly text: string;
}

/** Display math: `text` is the LaTeX. */
export interface MathBlock extends BlockBase<"math"> {
  readonly text: string;
}

export type Divider = BlockBase<"divider">;

export type ColumnAlignment = "left" | "center" | "right" | null;

export interface Table extends BlockBase<"table"> {
  /** Whether the first row is a header row, and how each column aligns. */
  readonly attrs: { readonly header: boolean; readonly align: readonly ColumnAlignment[] };
  readonly children: readonly TableRow[];
}

export interface TableRow extends BlockBase<"tableRow"> {
  readonly children: readonly TableCell[];
}

export interface TableCell extends BlockBase<"tableCell"> {
  readonly content: readonly Inline[];
}

export interface Columns extends BlockBase<"columns"> {
  readonly children: readonly Column[];
}

export interface Column extends BlockBase<"column"> {
  /** The column's share of the width, from 0 to 1. */
  readonly attrs?: { readonly width: number };
  readonly children: readonly ContentBlock[];
}

export interface Image extends BlockBase<"image"> {
  readonly attrs: {
    readonly src: string;
    readonly alt?: string;
    readonly title?: string;
    /** The width shown, in CSS pixels. */
    readonly width?: number;
  };
}

/** An attached file, shown by its kind: PDF, audio, video or a download. */
export interface FileBlock extends BlockBase<"file"> {
  readonly attrs: { readonly src: string; readonly name?: string };
}

/** A web link shown with a preview. */
export interface Bookmark extends BlockBase<"bookmark"> {
  readonly attrs: { readonly url: string };
}

/** Another note, or a part of one, shown in place. */
export interface Embed extends BlockBase<"embed"> {
  readonly attrs: {
    readonly target: LinkTarget;
    /** What follows `|` in `![[target|alias]]`: for an image, Obsidian reads a size such as `300` or `300x200`. */
    readonly alias?: string;
  };
}

/** A database shown inline; the database itself is a note. */
export interface DatabaseBlock extends BlockBase<"database"> {
  readonly attrs: { readonly database: NoteId; readonly view?: ViewId };
}

/** Markdown that Nether keeps byte for byte because it cannot map it to blocks. */
export interface RawBlock extends BlockBase<"raw"> {
  readonly text: string;
}

/** A block type a plugin adds, named `plugin-id/type`. */
export interface PluginBlock {
  readonly id: BlockId;
  readonly type: `${string}/${string}`;
  readonly attrs?: JsonObject;
  readonly content?: readonly Inline[];
  readonly children?: readonly ContentBlock[];
}

/** The blocks that can stand in a note or a container; rows, cells and columns live only in their parents. */
export type ContentBlock =
  | Paragraph
  | Heading
  | BulletListItem
  | NumberedListItem
  | TaskListItem
  | Quote
  | Callout
  | Toggle
  | CodeBlock
  | MathBlock
  | Divider
  | Table
  | Columns
  | Image
  | FileBlock
  | Bookmark
  | Embed
  | DatabaseBlock
  | RawBlock
  | PluginBlock;

export type Block = ContentBlock | TableRow | TableCell | Column;

export const blockTypes = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "taskListItem",
  "quote",
  "callout",
  "toggle",
  "code",
  "math",
  "divider",
  "table",
  "tableRow",
  "tableCell",
  "columns",
  "column",
  "image",
  "file",
  "bookmark",
  "embed",
  "database",
  "raw",
] as const;

type BuiltInType = (typeof blockTypes)[number];

const pluginTypePattern = /^[a-z][a-z0-9-]*\/[a-z][a-zA-Z0-9-]*$/;
// Letters, digits and the marks that combine with them, as an accent written
// as its own character after a letter.
const tagPattern = /^[\p{L}\p{N}\p{M}_-]+(?:\/[\p{L}\p{N}\p{M}_-]+)*$/u;

/** Whether a string is a tag name as Obsidian allows it, without its `#`: `project` or `area/research`. */
export function isTagName(name: string): boolean {
  return tagPattern.test(name) && !/^\d+$/.test(name);
}

export function readLinkTarget(value: unknown, path: string): LinkTarget {
  const fields = readFields(value, path, [], ["note", "title", "heading", "block"]);
  const heading = readOptional(fields, "heading", path, readName);
  const block = readOptional(fields, "block", path, readBlockId);
  if (heading !== undefined && block !== undefined) {
    fail(path, "can point at a heading or a block, not both");
  }
  const narrow = {
    ...(heading === undefined ? {} : { heading }),
    ...(block === undefined ? {} : { block }),
  };
  if (fields.note !== undefined && fields.title !== undefined) {
    fail(path, "has both a note and a title: give one");
  }
  if (fields.note !== undefined)
    return { note: readNoteId(fields.note, `${path}.note`), ...narrow };
  if (fields.title !== undefined)
    return { title: readName(fields.title, `${path}.title`), ...narrow };
  if (heading !== undefined) return { heading };
  if (block !== undefined) return { block };
  return fail(path, "needs a note, a title, or a heading or block of this note");
}

function readMark(value: unknown, path: string): Mark {
  const fields = readFields(value, path, ["type"], ["href", "title"]);
  const type = readOneOf(fields.type, `${path}.type`, markTypes);
  if (type === "link") {
    if (fields.href === undefined) fail(`${path}.href`, "is missing");
    const href = readName(fields.href, `${path}.href`);
    const title = readOptional(fields, "title", path, readString);
    return title === undefined ? { type, href } : { type, href, title };
  }
  if (fields.href !== undefined || fields.title !== undefined) {
    fail(path, "has a link's fields but is not a link");
  }
  return { type };
}

const inlineTypes = ["text", "hardBreak", "wikiLink", "tag", "math", "raw"] as const;

function readInline(value: unknown, path: string): Inline {
  // The type first: an unknown type explains an unknown field better than the field does.
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    readOneOf((value as Record<string, unknown>).type, `${path}.type`, inlineTypes);
  }
  const fields = readFields(
    value,
    path,
    ["type"],
    ["text", "marks", "target", "alias", "name", "latex", "markdown"],
  );
  const type = readOneOf(fields.type, `${path}.type`, inlineTypes);
  const allow = (...keys: string[]): void => {
    for (const key of Object.keys(fields)) {
      if (key !== "type" && !keys.includes(key))
        fail(`${path}.${key}`, `is not a field of ${type}`);
    }
  };
  const marked = (): Marked => {
    if (fields.marks === undefined) return {};
    const seen = new Set<string>();
    const marks = readArray(fields.marks, `${path}.marks`).map((item, index) => {
      const mark = readMark(item, `${path}.marks[${String(index)}]`);
      if (seen.has(mark.type)) fail(`${path}.marks[${String(index)}]`, `repeats ${mark.type}`);
      seen.add(mark.type);
      return mark;
    });
    return { marks };
  };
  switch (type) {
    case "text": {
      allow("text", "marks");
      const text = readString(fields.text, `${path}.text`);
      if (text === "") fail(`${path}.text`, "must not be empty");
      return { type, text, ...marked() };
    }
    case "hardBreak":
      allow();
      return { type };
    case "wikiLink": {
      allow("target", "alias", "marks");
      const target = readLinkTarget(fields.target, `${path}.target`);
      const alias = readOptional(fields, "alias", path, readName);
      return { type, target, ...(alias === undefined ? {} : { alias }), ...marked() };
    }
    case "tag": {
      allow("name", "marks");
      const name = readString(fields.name, `${path}.name`);
      if (!isTagName(name))
        fail(`${path}.name`, "must be a tag name such as project or area/research");
      return { type, name, ...marked() };
    }
    case "math":
      allow("latex", "marks");
      return { type, latex: readText(fields.latex, `${path}.latex`), ...marked() };
    case "raw":
      allow("markdown", "marks");
      return { type, markdown: readText(fields.markdown, `${path}.markdown`), ...marked() };
  }
}

function readInlines(value: unknown, path: string): readonly Inline[] {
  return readArray(value, path).map((item, index) => readInline(item, `${path}[${String(index)}]`));
}

/** Where a block stands, which decides the block types allowed there. */
type Place = "content" | "table" | "row" | "columns";

interface Reader {
  /** Block IDs seen so far in the note, which must be unique. */
  readonly ids: Set<string>;
}

const placeOf: Partial<Record<BuiltInType, Place>> = {
  tableRow: "table",
  tableCell: "row",
  column: "columns",
};

const placeNames: Record<Place, string> = {
  content: "a note or a container block",
  table: "a table",
  row: "a table row",
  columns: "columns",
};

function readBlock(value: unknown, path: string, place: Place, reader: Reader): Block {
  const fields = readFields(value, path, ["id", "type"], ["attrs", "content", "children", "text"]);
  const id = readBlockId(fields.id, `${path}.id`);
  if (reader.ids.has(id)) fail(`${path}.id`, `repeats the block ID "${id}"`);
  reader.ids.add(id);
  const type = readString(fields.type, `${path}.type`);

  if (pluginTypePattern.test(type)) {
    if (place !== "content") fail(`${path}.type`, `cannot stand in ${placeNames[place]}`);
    if (fields.text !== undefined) fail(`${path}.text`, "is not a field of plugin blocks");
    const attrs = readOptional(fields, "attrs", path, (item, itemPath) =>
      readJsonObject(item, itemPath),
    );
    const content = readOptional(fields, "content", path, readInlines);
    const children = readOptional(fields, "children", path, (item, itemPath) =>
      readBlocks(item, itemPath, "content", reader),
    );
    return {
      id,
      type: type as `${string}/${string}`,
      ...(attrs === undefined ? {} : { attrs }),
      ...(content === undefined ? {} : { content }),
      ...(children === undefined ? {} : { children: children as readonly ContentBlock[] }),
    };
  }

  if (!(blockTypes as readonly string[]).includes(type)) {
    fail(
      `${path}.type`,
      `is not a block type: use a built-in one, or a plugin's such as "my-plugin/board"`,
    );
  }
  const builtIn = type as BuiltInType;
  const expected = placeOf[builtIn] ?? "content";
  if (expected !== place) fail(`${path}.type`, `${builtIn} cannot stand in ${placeNames[place]}`);

  // Which of attrs, content, children and text each type has.
  const has = (...keys: ("attrs" | "content" | "children" | "text")[]): void => {
    for (const key of ["attrs", "content", "children", "text"] as const) {
      if (fields[key] !== undefined && !keys.includes(key)) {
        fail(`${path}.${key}`, `is not a field of ${builtIn}`);
      }
    }
  };
  const attrs = (required: readonly string[], optional: readonly string[] = []) =>
    readFields(fields.attrs, `${path}.attrs`, required, optional);
  const content = (): readonly Inline[] => readInlines(fields.content ?? [], `${path}.content`);
  const children = (): readonly ContentBlock[] | undefined =>
    readOptional(fields, "children", path, (item, itemPath) =>
      readBlocks(item, itemPath, "content", reader),
    ) as readonly ContentBlock[] | undefined;
  const withChildren = <T extends object>(block: T): T => {
    const nested = children();
    return nested === undefined ? block : { ...block, children: nested };
  };
  const text = (): string => readString(fields.text ?? "", `${path}.text`);

  switch (builtIn) {
    case "paragraph":
      has("content");
      return { id, type: builtIn, content: content() };
    case "heading": {
      has("attrs", "content");
      const level = readInteger(attrs(["level"]).level, `${path}.attrs.level`, 1, 6);
      return {
        id,
        type: builtIn,
        attrs: { level: level as 1 | 2 | 3 | 4 | 5 | 6 },
        content: content(),
      };
    }
    case "bulletListItem":
    case "toggle":
      has("content", "children");
      return withChildren({ id, type: builtIn, content: content() });
    case "numberedListItem": {
      has("attrs", "content", "children");
      const start =
        fields.attrs === undefined
          ? undefined
          : readInteger(attrs(["start"]).start, `${path}.attrs.start`, 0, 999_999_999);
      return withChildren({
        id,
        type: builtIn,
        ...(start === undefined ? {} : { attrs: { start } }),
        content: content(),
      });
    }
    case "taskListItem": {
      has("attrs", "content", "children");
      const checked = readBoolean(attrs(["checked"]).checked, `${path}.attrs.checked`);
      return withChildren({ id, type: builtIn, attrs: { checked }, content: content() });
    }
    case "quote":
      has("children");
      return { id, type: builtIn, children: children() ?? [] };
    case "callout": {
      has("attrs", "content", "children");
      const calloutAttrs = attrs(["kind"], ["fold"]);
      const kind = readLine(calloutAttrs.kind, `${path}.attrs.kind`);
      if (!/^[a-z][a-z0-9-]*$/.test(kind)) {
        fail(`${path}.attrs.kind`, "must be lowercase letters, digits and dashes, such as note");
      }
      const fold = readOptional(calloutAttrs, "fold", `${path}.attrs`, (item, itemPath) =>
        readOneOf(item, itemPath, ["open", "closed"] as const),
      );
      return withChildren({
        id,
        type: builtIn,
        attrs: fold === undefined ? { kind } : { kind, fold },
        content: content(),
      });
    }
    case "code": {
      has("attrs", "text");
      const language = readLine(attrs(["language"]).language, `${path}.attrs.language`);
      return { id, type: builtIn, attrs: { language }, text: text() };
    }
    case "math":
      has("text");
      return { id, type: builtIn, text: text() };
    case "divider":
      has();
      return { id, type: builtIn };
    case "table": {
      has("attrs", "children");
      const tableAttrs = attrs(["header", "align"]);
      const header = readBoolean(tableAttrs.header, `${path}.attrs.header`);
      const align = readArray(tableAttrs.align, `${path}.attrs.align`).map((item, index) =>
        item === null
          ? null
          : readOneOf(item, `${path}.attrs.align[${String(index)}]`, [
              "left",
              "center",
              "right",
            ] as const),
      );
      if (align.length === 0) fail(`${path}.attrs.align`, "needs at least one column");
      const rows = readBlocks(
        fields.children ?? [],
        `${path}.children`,
        "table",
        reader,
      ) as TableRow[];
      rows.forEach((row, index) => {
        if (row.children.length !== align.length) {
          fail(
            `${path}.children[${String(index)}]`,
            `has ${String(row.children.length)} cells, but the table has ${String(align.length)} columns`,
          );
        }
      });
      return { id, type: builtIn, attrs: { header, align }, children: rows };
    }
    case "tableRow":
      has("children");
      return {
        id,
        type: builtIn,
        children: readBlocks(
          fields.children ?? [],
          `${path}.children`,
          "row",
          reader,
        ) as TableCell[],
      };
    case "tableCell":
      has("content");
      return { id, type: builtIn, content: content() };
    case "columns": {
      has("children");
      const columns = readBlocks(fields.children ?? [], `${path}.children`, "columns", reader);
      if (columns.length < 2) fail(`${path}.children`, "needs at least two columns");
      return { id, type: builtIn, children: columns as Column[] };
    }
    case "column": {
      has("attrs", "children");
      const width =
        fields.attrs === undefined
          ? undefined
          : readNumber(attrs(["width"]).width, `${path}.attrs.width`);
      if (width !== undefined && (width <= 0 || width > 1)) {
        fail(`${path}.attrs.width`, "must be more than 0 and at most 1");
      }
      return {
        id,
        type: builtIn,
        ...(width === undefined ? {} : { attrs: { width } }),
        children: children() ?? [],
      };
    }
    case "image": {
      has("attrs");
      const imageAttrs = attrs(["src"], ["alt", "title", "width"]);
      const alt = readOptional(imageAttrs, "alt", `${path}.attrs`, readString);
      const title = readOptional(imageAttrs, "title", `${path}.attrs`, readString);
      const width = readOptional(imageAttrs, "width", `${path}.attrs`, (item, itemPath) =>
        readInteger(item, itemPath, 1, 100_000),
      );
      return {
        id,
        type: builtIn,
        attrs: {
          src: readName(imageAttrs.src, `${path}.attrs.src`),
          ...(alt === undefined ? {} : { alt }),
          ...(title === undefined ? {} : { title }),
          ...(width === undefined ? {} : { width }),
        },
      };
    }
    case "file": {
      has("attrs");
      const fileAttrs = attrs(["src"], ["name"]);
      const name = readOptional(fileAttrs, "name", `${path}.attrs`, readName);
      return {
        id,
        type: builtIn,
        attrs: {
          src: readName(fileAttrs.src, `${path}.attrs.src`),
          ...(name === undefined ? {} : { name }),
        },
      };
    }
    case "bookmark": {
      has("attrs");
      const url = readName(attrs(["url"]).url, `${path}.attrs.url`);
      if (!/^https?:\/\/\S+$/.test(url)) fail(`${path}.attrs.url`, "must be an http or https URL");
      return { id, type: builtIn, attrs: { url } };
    }
    case "embed": {
      has("attrs");
      const embedAttrs = attrs(["target"], ["alias"]);
      const target = readLinkTarget(embedAttrs.target, `${path}.attrs.target`);
      const alias = readOptional(embedAttrs, "alias", `${path}.attrs`, readName);
      return { id, type: builtIn, attrs: alias === undefined ? { target } : { target, alias } };
    }
    case "database": {
      has("attrs");
      const databaseAttrs = attrs(["database"], ["view"]);
      const database = readNoteId(databaseAttrs.database, `${path}.attrs.database`);
      const view = readOptional(databaseAttrs, "view", `${path}.attrs`, readViewId);
      return { id, type: builtIn, attrs: view === undefined ? { database } : { database, view } };
    }
    case "raw":
      has("text");
      return { id, type: builtIn, text: text() };
  }
}

function readBlocks(value: unknown, path: string, place: Place, reader: Reader): Block[] {
  return readArray(value, path).map((item, index) =>
    readBlock(item, `${path}[${String(index)}]`, place, reader),
  );
}

/** Reads a note's content. Block IDs must be unique across the whole tree. */
export function readContent(value: unknown, path: string): ContentBlock[] {
  return readBlocks(value, path, "content", { ids: new Set() }) as ContentBlock[];
}

/** Every block in a tree, depth first, parents before their children. */
export function* walkBlocks(blocks: readonly Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    if ("children" in block) yield* walkBlocks(block.children);
  }
}

/** The inline content of a block, or an empty list for blocks without it. */
export function inlineContent(block: Block): readonly Inline[] {
  return "content" in block ? block.content : [];
}
