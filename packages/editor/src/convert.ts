// A note's blocks to the editor's document and back. The core model keeps a
// list item as a block of its own, as Notion does; the editor keeps lists as
// ProseMirror does, items inside a list node, so that Enter, Tab and
// Backspace in lists work as people expect. Going there and back gives the
// same blocks.
import type {
  BlockId,
  ColumnAlignment,
  ContentBlock,
  Inline,
  LinkTarget,
  Mark,
  NoteId,
  TableRow as CoreTableRow,
  ViewId,
} from "@nether/core";
import { markTypes } from "@nether/core";
import type { JSONContent } from "@tiptap/core";

type Attrs = Record<string, unknown>;

const markNames: Readonly<Record<Mark["type"], string>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  code: "code",
  highlight: "highlight",
  comment: "comment",
  link: "link",
};

function marksToEditor(marks: readonly Mark[] | undefined): JSONContent["marks"] {
  if (marks === undefined || marks.length === 0) return undefined;
  return marks.map((mark) =>
    mark.type === "link"
      ? {
          type: "link",
          attrs: { href: mark.href, ...(mark.title === undefined ? {} : { title: mark.title }) },
        }
      : { type: markNames[mark.type] },
  );
}

function withMarks(node: JSONContent, marks: readonly Mark[] | undefined): JSONContent {
  const editorMarks = marksToEditor(marks);
  return editorMarks === undefined ? node : { ...node, marks: editorMarks };
}

export function inlinesToEditor(inlines: readonly Inline[]): JSONContent[] {
  return inlines.map((inline): JSONContent => {
    switch (inline.type) {
      case "text":
        return withMarks({ type: "text", text: inline.text }, inline.marks);
      case "hardBreak":
        return { type: "hardBreak" };
      case "wikiLink":
        return withMarks(
          { type: "wikiLink", attrs: { target: inline.target, alias: inline.alias ?? null } },
          inline.marks,
        );
      case "tag":
        return withMarks({ type: "tag", attrs: { name: inline.name } }, inline.marks);
      case "math":
        return withMarks({ type: "mathInline", attrs: { latex: inline.latex } }, inline.marks);
      case "raw":
        return withMarks({ type: "rawInline", attrs: { markdown: inline.markdown } }, inline.marks);
    }
  });
}

function paragraph(content: readonly Inline[]): JSONContent {
  const nodes = inlinesToEditor(content);
  return nodes.length === 0 ? { type: "paragraph" } : { type: "paragraph", content: nodes };
}

function idAttrs(id: BlockId, attrs: Attrs = {}): Attrs {
  return { id, ...attrs };
}

type ListKind = "bulletList" | "orderedList" | "taskList";

function listKind(block: ContentBlock): ListKind | undefined {
  switch (block.type) {
    case "bulletListItem":
      return "bulletList";
    case "numberedListItem":
      return "orderedList";
    case "taskListItem":
      return "taskList";
    default:
      return undefined;
  }
}

/** Blocks to the editor's nodes, gathering list items that follow each other into lists. */
export function blocksToEditor(blocks: readonly ContentBlock[]): JSONContent[] {
  const out: JSONContent[] = [];
  let list: JSONContent | undefined;
  for (const block of blocks) {
    const kind = listKind(block);
    if (
      kind !== undefined &&
      (block.type === "bulletListItem" ||
        block.type === "numberedListItem" ||
        block.type === "taskListItem")
    ) {
      const start = block.type === "numberedListItem" ? block.attrs?.start : undefined;
      if (list?.type !== kind || start !== undefined) {
        list =
          kind === "orderedList"
            ? { type: kind, attrs: { start: start ?? 1 }, content: [] }
            : { type: kind, content: [] };
        out.push(list);
      }
      const item: JSONContent = {
        type: kind === "taskList" ? "taskItem" : "listItem",
        attrs:
          block.type === "taskListItem"
            ? idAttrs(block.id, { checked: block.attrs.checked })
            : idAttrs(block.id),
        content: [paragraph(block.content), ...blocksToEditor(block.children ?? [])],
      };
      list.content?.push(item);
      continue;
    }
    list = undefined;
    out.push(blockToEditor(block));
  }
  return out;
}

function tableToEditor(block: Extract<ContentBlock, { type: "table" }>): JSONContent {
  return {
    type: "table",
    attrs: idAttrs(block.id, { align: [...block.attrs.align] }),
    content: block.children.map((row: CoreTableRow, index) => ({
      type: "tableRow",
      attrs: idAttrs(row.id),
      content: row.children.map((cell) => ({
        type: block.attrs.header && index === 0 ? "tableHeader" : "tableCell",
        attrs: idAttrs(cell.id),
        content: [paragraph(cell.content)],
      })),
    })),
  };
}

/** Inline content as text: a link, tag or math keeps the text it shows, a break becomes a space. */
function summaryText(inlines: readonly Inline[]): Inline[] {
  const out: Extract<Inline, { type: "text" }>[] = [];
  for (const inline of inlines) {
    const value =
      inline.type === "text"
        ? inline.text
        : inline.type === "hardBreak"
          ? " "
          : inline.type === "wikiLink"
            ? (inline.alias ?? linkText(inline.target))
            : inline.type === "tag"
              ? `#${inline.name}`
              : inline.type === "math"
                ? inline.latex
                : inline.markdown;
    const marks = "marks" in inline ? inline.marks : undefined;
    if (value === "") continue;
    const last = out[out.length - 1];
    if (last !== undefined && sameMarks(last.marks, marks)) {
      out[out.length - 1] = { ...last, text: last.text + value };
    } else {
      out.push(
        marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks },
      );
    }
  }
  return out;
}

function linkText(target: LinkTarget): string {
  let text = "title" in target ? target.title : "note" in target ? target.note : "";
  if ("heading" in target) text += `#${target.heading}`;
  if ("block" in target) text += `#^${target.block}`;
  return text;
}

/** Content for a node that needs at least one block: an empty paragraph stands in for none. */
function someBlocks(blocks: readonly ContentBlock[] | undefined): JSONContent[] {
  const nodes = blocksToEditor(blocks ?? []);
  return nodes.length === 0 ? [{ type: "paragraph" }] : nodes;
}

function blockToEditor(block: ContentBlock): JSONContent {
  switch (block.type) {
    case "paragraph":
      return { ...paragraph(block.content), attrs: idAttrs(block.id) };
    case "heading": {
      const nodes = inlinesToEditor(block.content);
      return {
        type: "heading",
        attrs: idAttrs(block.id, { level: block.attrs.level }),
        ...(nodes.length === 0 ? {} : { content: nodes }),
      };
    }
    case "quote":
      return { type: "blockquote", attrs: idAttrs(block.id), content: someBlocks(block.children) };
    case "callout": {
      const title = inlinesToEditor(block.content);
      return {
        type: "callout",
        attrs: idAttrs(block.id, { kind: block.attrs.kind, fold: block.attrs.fold ?? null }),
        content: [
          title.length === 0 ? { type: "calloutTitle" } : { type: "calloutTitle", content: title },
          ...blocksToEditor(block.children ?? []),
        ],
      };
    }
    case "toggle": {
      // A toggle's summary holds text only, as Markdown writes it in <summary>.
      const summary = inlinesToEditor(summaryText(block.content));
      return {
        type: "details",
        attrs: idAttrs(block.id),
        content: [
          summary.length === 0
            ? { type: "detailsSummary" }
            : { type: "detailsSummary", content: summary },
          { type: "detailsContent", content: someBlocks(block.children) },
        ],
      };
    }
    case "code":
      return {
        type: "codeBlock",
        attrs: idAttrs(block.id, {
          language: block.attrs.language === "" ? null : block.attrs.language,
        }),
        ...(block.text === "" ? {} : { content: [{ type: "text", text: block.text }] }),
      };
    case "math":
      return { type: "mathBlock", attrs: idAttrs(block.id, { latex: block.text }) };
    case "divider":
      return { type: "horizontalRule", attrs: idAttrs(block.id) };
    case "table":
      return tableToEditor(block);
    case "columns":
      return {
        type: "columns",
        attrs: idAttrs(block.id),
        content: block.children.map((column) => ({
          type: "column",
          attrs: idAttrs(column.id, { width: column.attrs?.width ?? null }),
          content: someBlocks(column.children),
        })),
      };
    case "image":
      return {
        type: "image",
        attrs: idAttrs(block.id, {
          src: block.attrs.src,
          alt: block.attrs.alt ?? null,
          title: block.attrs.title ?? null,
          width: block.attrs.width ?? null,
        }),
      };
    case "file":
      return {
        type: "file",
        attrs: idAttrs(block.id, { src: block.attrs.src, name: block.attrs.name ?? null }),
      };
    case "bookmark":
      return { type: "bookmark", attrs: idAttrs(block.id, { url: block.attrs.url }) };
    case "embed":
      return {
        type: "embed",
        attrs: idAttrs(block.id, { target: block.attrs.target, alias: block.attrs.alias ?? null }),
      };
    case "database":
      return {
        type: "database",
        attrs: idAttrs(block.id, {
          database: block.attrs.database,
          view: block.attrs.view ?? null,
        }),
      };
    case "raw":
      return { type: "rawBlock", attrs: idAttrs(block.id, { text: block.text }) };
    case "bulletListItem":
    case "numberedListItem":
    case "taskListItem":
      return blocksToEditor([block])[0] ?? { type: "paragraph" };
    default: {
      const { id, type, ...data } = block;
      return { type: "pluginBlock", attrs: idAttrs(id, { pluginType: type, data }) };
    }
  }
}

/** A note's blocks as the editor's document. */
export function toEditor(blocks: readonly ContentBlock[]): JSONContent {
  const content = blocksToEditor(blocks);
  return { type: "doc", content: content.length === 0 ? [{ type: "paragraph" }] : content };
}

// Back from the editor.

function attrs(node: JSONContent): Attrs {
  return (node.attrs ?? {}) as Attrs;
}

function stringAttr(node: JSONContent, name: string): string | undefined {
  const value = attrs(node)[name];
  return typeof value === "string" ? value : undefined;
}

function numberAttr(node: JSONContent, name: string): number | undefined {
  const value = attrs(node)[name];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
}

function blockId(node: JSONContent, fallback: () => BlockId): BlockId {
  return (stringAttr(node, "id") as BlockId | undefined) ?? fallback();
}

const markTypeOf: Readonly<Record<string, Mark["type"]>> = Object.fromEntries(
  Object.entries(markNames).map(([type, name]) => [name, type as Mark["type"]]),
);

function marksFromEditor(node: JSONContent): Mark[] | undefined {
  const marks = (node.marks ?? []).flatMap((mark): Mark[] => {
    const type = markTypeOf[mark.type];
    if (type === undefined) return [];
    if (type !== "link") return [{ type }];
    const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
    const title =
      typeof mark.attrs?.title === "string" && mark.attrs.title !== ""
        ? mark.attrs.title
        : undefined;
    return href.trim() === "" ? [] : [title === undefined ? { type, href } : { type, href, title }];
  });
  if (marks.length === 0) return undefined;
  return marks.sort((a, b) => markTypes.indexOf(a.type) - markTypes.indexOf(b.type));
}

function sameMarks(a: readonly Mark[] | undefined, b: readonly Mark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function marked<T extends Inline>(inline: T, marks: Mark[] | undefined): T {
  return marks === undefined ? inline : { ...inline, marks };
}

export function inlinesFromEditor(nodes: readonly JSONContent[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes ?? []) {
    const marks = marksFromEditor(node);
    let inline: Inline | undefined;
    switch (node.type) {
      case "text":
        if (node.text !== undefined && node.text !== "")
          inline = marked({ type: "text", text: node.text }, marks);
        break;
      case "hardBreak":
        inline = { type: "hardBreak" };
        break;
      case "wikiLink": {
        const target = attrs(node).target as LinkTarget | null | undefined;
        const alias = stringAttr(node, "alias");
        if (target !== null && target !== undefined) {
          inline = marked(
            { type: "wikiLink", target, ...(alias === undefined ? {} : { alias }) },
            marks,
          );
        }
        break;
      }
      case "tag": {
        const name = stringAttr(node, "name");
        if (name !== undefined && name !== "") inline = marked({ type: "tag", name }, marks);
        break;
      }
      case "mathInline": {
        const latex = stringAttr(node, "latex");
        if (latex !== undefined && latex.trim() !== "")
          inline = marked({ type: "math", latex }, marks);
        break;
      }
      case "rawInline": {
        const markdown = stringAttr(node, "markdown");
        if (markdown !== undefined && markdown.trim() !== "")
          inline = marked({ type: "raw", markdown }, marks);
        break;
      }
      default:
        break;
    }
    if (inline === undefined) continue;
    const last = out[out.length - 1];
    if (inline.type === "text" && last?.type === "text" && sameMarks(last.marks, inline.marks)) {
      out[out.length - 1] = { ...last, text: last.text + inline.text };
    } else {
      out.push(inline);
    }
  }
  return out;
}

/** The inline content of a node that holds inline content or a first paragraph. */
function firstInlines(node: JSONContent | undefined): Inline[] {
  if (node === undefined) return [];
  return inlinesFromEditor(node.content);
}

/**
 * Whether nodes are only an empty paragraph, which stands in for no blocks
 * where the editor needs one, and which Markdown could not hold anyway.
 */
function onlyEmpty(nodes: readonly JSONContent[]): boolean {
  const [first] = nodes;
  return nodes.length === 1 && first?.type === "paragraph" && (first.content ?? []).length === 0;
}

function children(nodes: readonly JSONContent[] | undefined, newId: () => BlockId): ContentBlock[] {
  const list = nodes ?? [];
  return onlyEmpty(list) ? [] : blocksFromEditor(list, newId);
}

function cellInlines(cell: JSONContent): Inline[] {
  // A Markdown table cell holds one line: paragraphs in a cell are joined by line breaks.
  const out: Inline[] = [];
  for (const node of cell.content ?? []) {
    const inlines = inlinesFromEditor(node.content);
    if (out.length > 0 && inlines.length > 0) out.push({ type: "hardBreak" });
    out.push(...inlines);
  }
  return out;
}

/** The editor's nodes back to blocks; `newId` names a block the editor gave no ID. */
export function blocksFromEditor(
  nodes: readonly JSONContent[],
  newId: () => BlockId,
): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const start = node.type === "orderedList" ? (numberAttr(node, "start") ?? 1) : 1;
        (node.content ?? []).forEach((item, index) => {
          const [first, ...rest] = item.content ?? [];
          const content = first?.type === "paragraph" ? firstInlines(first) : [];
          const nested = blocksFromEditor(
            first?.type === "paragraph" ? rest : (item.content ?? []),
            newId,
          );
          const base = {
            id: blockId(item, newId),
            content,
            ...(nested.length === 0 ? {} : { children: nested }),
          };
          if (node.type === "taskList") {
            out.push({
              ...base,
              type: "taskListItem",
              attrs: { checked: attrs(item).checked === true },
            });
          } else if (node.type === "orderedList") {
            out.push(
              index === 0 && start !== 1
                ? { ...base, type: "numberedListItem", attrs: { start } }
                : { ...base, type: "numberedListItem" },
            );
          } else {
            out.push({ ...base, type: "bulletListItem" });
          }
        });
        break;
      }
      default: {
        const block = blockFromEditor(node, newId);
        if (block !== undefined) out.push(block);
      }
    }
  }
  return out;
}

function blockFromEditor(node: JSONContent, newId: () => BlockId): ContentBlock | undefined {
  const id = blockId(node, newId);
  switch (node.type) {
    case "paragraph":
      return { id, type: "paragraph", content: inlinesFromEditor(node.content) };
    case "heading": {
      const level = Math.min(6, Math.max(1, numberAttr(node, "level") ?? 1)) as
        1 | 2 | 3 | 4 | 5 | 6;
      return { id, type: "heading", attrs: { level }, content: inlinesFromEditor(node.content) };
    }
    case "blockquote":
      return { id, type: "quote", children: children(node.content, newId) };
    case "callout": {
      const [title, ...body] = node.content ?? [];
      const nested = blocksFromEditor(
        title?.type === "calloutTitle" ? body : (node.content ?? []),
        newId,
      );
      const fold = stringAttr(node, "fold");
      return {
        id,
        type: "callout",
        attrs: {
          kind: stringAttr(node, "kind") ?? "note",
          ...(fold === "open" || fold === "closed" ? { fold } : {}),
        },
        content: title?.type === "calloutTitle" ? firstInlines(title) : [],
        ...(nested.length === 0 ? {} : { children: nested }),
      };
    }
    case "details": {
      const summary = (node.content ?? []).find((child) => child.type === "detailsSummary");
      const body = (node.content ?? []).find((child) => child.type === "detailsContent");
      const nested = children(body?.content, newId);
      return {
        id,
        type: "toggle",
        content: firstInlines(summary),
        ...(nested.length === 0 ? {} : { children: nested }),
      };
    }
    case "codeBlock":
      return {
        id,
        type: "code",
        attrs: { language: stringAttr(node, "language") ?? "" },
        text: (node.content ?? []).map((child) => child.text ?? "").join(""),
      };
    case "mathBlock":
      return { id, type: "math", text: stringAttr(node, "latex") ?? "" };
    case "horizontalRule":
      return { id, type: "divider" };
    case "table": {
      const rows = node.content ?? [];
      const width = Math.max(1, ...rows.map((row) => (row.content ?? []).length));
      const align = (Array.isArray(attrs(node).align) ? (attrs(node).align as unknown[]) : []).map(
        (value): ColumnAlignment =>
          value === "left" || value === "center" || value === "right" ? value : null,
      );
      return {
        id,
        type: "table",
        attrs: {
          header: (rows[0]?.content ?? []).some((cell) => cell.type === "tableHeader"),
          align: Array.from({ length: width }, (_, index) => align[index] ?? null),
        },
        children: rows.map((row) => ({
          id: blockId(row, newId),
          type: "tableRow",
          children: Array.from({ length: width }, (_, index) => {
            const cell = row.content?.[index];
            return {
              id: cell === undefined ? newId() : blockId(cell, newId),
              type: "tableCell" as const,
              content: cell === undefined ? [] : cellInlines(cell),
            };
          }),
        })),
      };
    }
    case "columns": {
      const columns = (node.content ?? []).map((column) => {
        const width = numberAttr(column, "width");
        return {
          id: blockId(column, newId),
          type: "column" as const,
          ...(width === undefined || width <= 0 || width > 1 ? {} : { attrs: { width } }),
          children: children(column.content, newId),
        };
      });
      // A single column left is no longer columns: its blocks stand on their own.
      if (columns.length < 2) return undefined;
      return { id, type: "columns", children: columns };
    }
    case "image": {
      const src = stringAttr(node, "src") ?? "";
      const alt = stringAttr(node, "alt");
      const title = stringAttr(node, "title");
      const width = numberAttr(node, "width");
      return {
        id,
        type: "image",
        attrs: {
          src,
          ...(alt === undefined ? {} : { alt }),
          ...(title === undefined ? {} : { title }),
          ...(width === undefined ? {} : { width: Math.round(width) }),
        },
      };
    }
    case "file": {
      const name = stringAttr(node, "name");
      return {
        id,
        type: "file",
        attrs: { src: stringAttr(node, "src") ?? "", ...(name === undefined ? {} : { name }) },
      };
    }
    case "bookmark":
      return { id, type: "bookmark", attrs: { url: stringAttr(node, "url") ?? "" } };
    case "embed": {
      const target = attrs(node).target as LinkTarget | null | undefined;
      const alias = stringAttr(node, "alias");
      if (target === null || target === undefined) return undefined;
      return { id, type: "embed", attrs: { target, ...(alias === undefined ? {} : { alias }) } };
    }
    case "database": {
      const view = stringAttr(node, "view");
      return {
        id,
        type: "database",
        attrs: {
          database: (stringAttr(node, "database") ?? "") as NoteId,
          ...(view === undefined ? {} : { view: view as ViewId }),
        },
      };
    }
    case "rawBlock":
      return { id, type: "raw", text: stringAttr(node, "text") ?? "" };
    case "pluginBlock": {
      const type = stringAttr(node, "pluginType") ?? "";
      const data = attrs(node).data;
      return {
        ...(typeof data === "object" && data !== null ? data : {}),
        id,
        type,
      } as ContentBlock;
    }
    default:
      return undefined;
  }
}

/** The editor's document as a note's blocks. */
export function fromEditor(doc: JSONContent, newId: () => BlockId): ContentBlock[] {
  return blocksFromEditor(doc.content ?? [], newId);
}
