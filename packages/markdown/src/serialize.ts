// A note back to Markdown. Given the source it was parsed from, every block
// whose content did not change keeps its exact bytes, and so do the blank
// lines between blocks that stayed side by side; only the rest is written
// anew (ADR 0003).
import type { BlockId, ContentBlock, NoteId } from "@nether/core";
import { writeFrontmatter } from "./frontmatter.ts";
import type { MarkdownNote } from "./parse.ts";
import {
  type Source,
  type SourceBlock,
  type SourceFrontmatter,
  type Style,
  defaultStyle,
  fingerprint,
  sameJson,
} from "./source.ts";
import { hasFrontmatter } from "./tree.ts";
import {
  type FreshOptions,
  type WriteContext,
  blocksToMdast,
  isListItem,
  sameList,
  write,
  writeListItem,
} from "./to-markdown.ts";

export interface SerializeOptions {
  /** The source the note was parsed from or last written to. */
  readonly source?: Source;
  /** Block IDs to write as `^id`, because something links to, embeds or comments on them. IDs the source wrote stay. */
  readonly writeIds?: ReadonlySet<BlockId>;
  /** The title to write for a link to a note given by its ID. */
  readonly noteTitle?: (note: NoteId) => string | undefined;
}

export interface Serialized {
  /** The file's new text. */
  readonly text: string;
  /** The source to give the next `serializeMarkdown` of this note. */
  readonly source: Source;
}

/** Thrown when properties change but the frontmatter could not be read, so writing it would lose what it holds. */
export class FrontmatterError extends Error {
  override readonly name = "FrontmatterError";
}

interface Placed {
  readonly block: ContentBlock;
  /** The index of the source block it matched, if any. */
  readonly index: number | undefined;
  /** Whether it keeps the bytes of that source block. */
  kept: boolean;
  text: string;
  idWritten: boolean;
}

function isEmptyParagraph(block: ContentBlock): boolean {
  return block.type === "paragraph" && block.content.length === 0;
}

function lineBreaks(text: string): number {
  return text.split("\n").length - 1;
}

/** Writes a note as Markdown, keeping the bytes of what did not change since `source`. */
export function serializeMarkdown(note: MarkdownNote, options: SerializeOptions = {}): Serialized {
  const source = options.source;
  const style: Style = source?.style ?? defaultStyle;
  const eol = source?.eol ?? "\n";
  const fresh = (text: string): string => (eol === "\n" ? text : text.replace(/\r?\n/g, "\r\n"));
  const entries: readonly SourceBlock[] = source?.blocks ?? [];
  const writtenBefore = new Set(
    entries.filter((entry) => entry.idWritten).map((entry) => entry.id),
  );
  const writeId = (id: BlockId): boolean =>
    options.writeIds?.has(id) === true || writtenBefore.has(id);
  const context: WriteContext = {
    style,
    writeId,
    noteTitle: options.noteTitle ?? (() => undefined),
  };

  // The frontmatter.
  let head = "";
  let frontmatter: SourceFrontmatter | undefined;
  const before = source?.frontmatter;
  if (before !== undefined && sameJson(before.properties, note.properties)) {
    head = source?.text.slice(before.start, before.end) ?? "";
    frontmatter = { ...before, start: 0, end: head.length };
  } else if (before?.error !== undefined) {
    throw new FrontmatterError(
      `The frontmatter is not valid YAML (${before.error}), so its properties cannot change. Fix it in source mode first.`,
    );
  } else if (note.properties.length > 0 || before !== undefined) {
    const yaml = writeFrontmatter(before?.yaml, before?.properties ?? [], note.properties);
    if (yaml !== undefined) {
      const body = yaml.replace(/\n$/, "");
      head = fresh(`---\n${body}\n---`);
      frontmatter = { start: 0, end: head.length, yaml: body, properties: note.properties };
    }
  }

  // Match each block to the source block it came from: by ID, or else by
  // content, looking ahead of the last match.
  const byId = new Map(entries.map((entry, index) => [entry.id, index]));
  const used = new Set<number>();
  let cursor = 0;
  const placed: Placed[] = [];
  for (const block of note.content) {
    if (isEmptyParagraph(block) && !writeId(block.id)) continue;
    const print = fingerprint(block);
    let index = byId.get(block.id);
    if (index !== undefined && used.has(index)) index = undefined;
    if (index === undefined) {
      for (let at = cursor; at < entries.length; at++) {
        const entry = entries[at];
        if (
          entry !== undefined &&
          !used.has(at) &&
          !entry.idWritten &&
          entry.fingerprint === print
        ) {
          index = at;
          break;
        }
      }
    }
    const entry = index === undefined ? undefined : entries[index];
    const keep =
      entry?.fingerprint === print &&
      entry.idWritten === writeId(block.id) &&
      (entry.id === block.id || !entry.idWritten);
    if (index !== undefined) {
      used.add(index);
      cursor = index + 1;
    }
    placed.push({
      block,
      index,
      kept: keep,
      text: keep ? (source?.text.slice(entry.start, entry.end) ?? "") : "",
      idWritten: keep ? entry.idWritten : writeId(block.id),
    });
  }

  // Write the blocks that changed, numbering lists as they run.
  let number = 0;
  placed.forEach((item, at) => {
    const previous = placed[at - 1];
    const { block } = item;
    const continues = previous !== undefined && sameList(previous.block, block);
    if (item.kept) {
      const written = /^\s*(\d{1,9})[.)]/.exec(item.text);
      // An item whose list now starts with it must carry the list's first number.
      const starts =
        block.type === "numberedListItem" &&
        !continues &&
        written !== null &&
        Number(written[1]) !== (block.attrs?.start ?? 1);
      if (!starts) {
        if (block.type === "numberedListItem" && written !== null) number = Number(written[1]);
        return;
      }
      item.kept = false;
      item.idWritten = writeId(block.id);
    }
    if (isListItem(block)) {
      if (block.type === "numberedListItem") {
        number = block.attrs?.start ?? (continues ? number + 1 : 1);
      }
      const marker = continues ? /^\s*([-*+]|\d{1,9}([.)]))/.exec(previous.text) : null;
      const neighbour: FreshOptions = {
        ...(marker?.[1] === "-" || marker?.[1] === "*" || marker?.[1] === "+"
          ? { bullet: marker[1] }
          : {}),
        ...(marker?.[2] === "." || marker?.[2] === ")" ? { bulletOrdered: marker[2] } : {}),
      };
      item.text = fresh(writeListItem(block, number, context, neighbour));
    } else {
      item.text = fresh(write(blocksToMdast([block], context), context));
    }
  });

  // Join them, keeping the original space between blocks that stayed neighbours.
  const gap = (previous: Placed, next: Placed): string => {
    const before = previous.index === undefined ? undefined : entries[previous.index];
    const after = next.index === undefined ? undefined : entries[next.index];
    if (
      source !== undefined &&
      before !== undefined &&
      after !== undefined &&
      next.index === (previous.index ?? -2) + 1
    ) {
      const between = source.text.slice(before.end, after.start);
      if (lineBreaks(between) >= 2 || sameList(previous.block, next.block)) return between;
    }
    return fresh(sameList(previous.block, next.block) ? "\n" : "\n\n");
  };

  let out = head;
  const first = placed[0];
  const firstEntry = entries[0];
  if (first !== undefined) {
    if (frontmatter !== undefined) {
      // After the frontmatter: the space the file had, or the next line, as Obsidian writes it.
      out +=
        before !== undefined && firstEntry !== undefined
          ? (source?.text.slice(before.end, firstEntry.start) ?? "")
          : fresh("\n");
    } else if (before === undefined && first.index === 0 && firstEntry !== undefined) {
      out += source?.text.slice(0, firstEntry.start) ?? "";
    }
  }
  const blocks: SourceBlock[] = [];
  placed.forEach((item, at) => {
    const previous = placed[at - 1];
    if (previous !== undefined) out += gap(previous, item);
    blocks.push({
      id: item.block.id,
      fingerprint: fingerprint(item.block),
      start: out.length,
      end: out.length + item.text.length,
      idWritten: item.idWritten,
    });
    out += item.text;
  });
  const last = placed[placed.length - 1];
  const lastEntry = entries[entries.length - 1];
  if (last?.index === entries.length - 1 && lastEntry !== undefined) {
    out += source?.text.slice(lastEntry.end) ?? "";
  } else if (
    last === undefined &&
    lastEntry === undefined &&
    source !== undefined &&
    (before === undefined) === (frontmatter === undefined)
  ) {
    // No blocks before or after: what followed the frontmatter, if any, stays.
    out += source.text.slice(before?.end ?? 0);
  } else if (out !== "") {
    out += eol;
  }

  // A note that opens with a `---` rule and has another `---` line later reads
  // as frontmatter, in Obsidian as here: such a first rule is written `***`.
  const opening = blocks[0];
  const openingBlock = placed[0]?.block;
  if (
    frontmatter === undefined &&
    opening?.start === 0 &&
    openingBlock?.type === "divider" &&
    hasFrontmatter(out)
  ) {
    const rule = fresh(write(blocksToMdast([openingBlock], context), context, { rule: "*" }));
    const shift = rule.length - (opening.end - opening.start);
    out = rule + out.slice(opening.end);
    blocks.forEach((block, index) => {
      blocks[index] =
        index === 0
          ? { ...block, end: rule.length }
          : { ...block, start: block.start + shift, end: block.end + shift };
    });
  }

  return {
    text: (source?.bom === true ? "﻿" : "") + out,
    source: {
      text: out,
      bom: source?.bom ?? false,
      eol,
      style,
      ...(frontmatter === undefined ? {} : { frontmatter }),
      blocks,
    },
  };
}
