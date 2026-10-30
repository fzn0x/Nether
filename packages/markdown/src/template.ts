// A note made from a filled template, as its file and its first blocks. The
// template's `{{cursor}}` was filled with a marker; it is taken out of the
// text, and its place kept as a block and an offset into that block's text,
// so the editor can put the cursor there. The block keeps its place even
// when the marker was all it held, as an empty paragraph or task, which the
// file cannot hold.
import type { Block, BlockId, ContentBlock, Inline, PropertyEntry } from "@nether/core";
import { type ParseOptions, parseMarkdown } from "./parse.ts";

/** Where a note's cursor goes: a block, and how far into its text. */
export interface TemplateCursor {
  readonly block: BlockId;
  /** Characters of text before the cursor, each inline that is not text, as a link, counting one. */
  readonly offset: number;
}

export interface TemplateNote {
  /** The note's file: the filled template without the marker. */
  readonly text: string;
  readonly properties: readonly PropertyEntry[];
  /** The note's blocks, with the block the marker was in. */
  readonly content: readonly ContentBlock[];
  /** Where the marker was, when it was in a block's text. */
  readonly cursor?: TemplateCursor;
}

function withoutMarker(
  inlines: readonly Inline[],
  marker: string,
): { readonly content: Inline[]; readonly offset: number } | undefined {
  let offset = 0;
  for (const [index, inline] of inlines.entries()) {
    if (inline.type !== "text") {
      offset += 1;
      continue;
    }
    const at = inline.text.indexOf(marker);
    if (at === -1) {
      offset += inline.text.length;
      continue;
    }
    const text = inline.text.slice(0, at) + inline.text.slice(at + marker.length);
    const content = [...inlines];
    if (text === "") content.splice(index, 1);
    else content[index] = { ...inline, text };
    return { content, offset: offset + at };
  }
  return undefined;
}

/** The blocks with the marker taken out of the first block whose text holds it, and where it was. */
function takeMarker<T extends Block>(
  blocks: readonly T[],
  marker: string,
): { readonly blocks: readonly T[]; readonly cursor?: TemplateCursor } {
  for (const [index, block] of blocks.entries()) {
    let taken: T | undefined;
    let cursor: TemplateCursor | undefined;
    if ("content" in block) {
      const found = withoutMarker(block.content, marker);
      if (found !== undefined) {
        taken = { ...block, content: found.content };
        cursor = { block: block.id, offset: found.offset };
      }
    } else if (block.type === "code") {
      const at = block.text.indexOf(marker);
      if (at !== -1) {
        taken = { ...block, text: block.text.slice(0, at) + block.text.slice(at + marker.length) };
        cursor = { block: block.id, offset: at };
      }
    }
    const children: readonly Block[] | undefined = "children" in block ? block.children : undefined;
    if (taken === undefined && children !== undefined) {
      const inner = takeMarker(children, marker);
      if (inner.cursor !== undefined) {
        taken = { ...block, children: inner.blocks };
        cursor = inner.cursor;
      }
    }
    if (taken !== undefined && cursor !== undefined) {
      const next = [...blocks];
      next[index] = taken;
      return { blocks: next, cursor };
    }
  }
  return { blocks };
}

/**
 * A note from a filled template whose cursor is `marker`, a character
 * found nowhere else in it, such as one from Unicode's private use area.
 */
export function templateNote(
  filled: string,
  marker: string,
  options: ParseOptions = {},
): TemplateNote {
  const text = filled.split(marker).join("");
  if (text !== filled) {
    const marked = parseMarkdown(filled, options);
    const taken = takeMarker(marked.content, marker);
    if (taken.cursor !== undefined) {
      // The marker is in one place only, and that a block's text: the properties are the file's.
      return { text, properties: marked.properties, content: taken.blocks, cursor: taken.cursor };
    }
  }
  // Without a marker, or with one outside the text of blocks, as in the frontmatter or a link's address.
  const plain = parseMarkdown(text, options);
  return { text, properties: plain.properties, content: plain.content };
}
