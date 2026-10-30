// The part of a note a link names: a heading with what follows it up to
// the next heading as high or higher, as Obsidian embeds `![[Note#Heading]]`,
// or one block by its ID, as it embeds `![[Note#^block]]`.
import type { Block, ContentBlock } from "@nether/core";

function headingOf(block: ContentBlock): { level: number; text: string } | undefined {
  if (block.type !== "heading") return undefined;
  const level = (block.attrs as { level?: number } | undefined)?.level ?? 1;
  const text = (block.content as readonly { type: string; text?: string }[])
    .map((inline) => inline.text ?? "")
    .join("")
    .trim();
  return { level, text };
}

function findBlock(blocks: readonly Block[], id: string): Block | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    if ("children" in block && Array.isArray(block.children)) {
      const found = findBlock(block.children as readonly Block[], id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * The blocks of the part of a note a link names: the whole note without a
 * heading or block, a heading's section, case and spaces aside, or one
 * block; undefined when the note has no such part.
 */
export function noteSection(
  blocks: readonly ContentBlock[],
  part: { readonly heading?: string; readonly block?: string },
): readonly ContentBlock[] | undefined {
  if (part.block !== undefined) {
    const block = findBlock(blocks, part.block);
    return block === undefined ? undefined : [block as ContentBlock];
  }
  if (part.heading === undefined) return blocks;
  const wanted = part.heading.trim().replace(/\s+/g, " ").toLowerCase();
  const headings = blocks.map(headingOf);
  const start = headings.findIndex(
    (heading) => heading?.text.replace(/\s+/g, " ").toLowerCase() === wanted,
  );
  if (start === -1) return undefined;
  const level = headings[start]?.level ?? 1;
  let end = start + 1;
  while (end < blocks.length) {
    const next = headings[end];
    if (next !== undefined && next.level <= level) break;
    end++;
  }
  return blocks.slice(start, end);
}
