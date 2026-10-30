// A note read again from its file, matched to the note Nether knows, and
// another app's edit merged into it (ADR 0003). A file holds a block's ID
// only where something links to the block, so a fresh read gives most
// blocks new IDs: matching them by content keeps the IDs that the note's
// document, links and comments know. The merge then applies, block by
// block, what changed in the file since Nether last wrote or read it.
import { type Block, type BlockId, type ContentBlock, newBlockId } from "@nether/core";
import type { ParsedMarkdown } from "./parse.ts";
import { fingerprint } from "./source.ts";

function childrenOf(block: Block): readonly Block[] {
  return "children" in block && Array.isArray(block.children) ? (block.children as Block[]) : [];
}

/**
 * The longest run, in order, of the two lists' items that are equal by
 * `key`, as pairs of indices: a classic longest common subsequence.
 */
function commonRun<T>(
  a: readonly T[],
  b: readonly T[],
  key: (item: T) => string,
): [number, number][] {
  const keysA = a.map(key);
  const keysB = b.map(key);
  // Lengths of the longest common runs of the suffixes, one row at a time from the end.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    const row = table[i] ?? [];
    const below = table[i + 1] ?? [];
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] =
        keysA[i] === keysB[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (keysA[i] === keysB[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }
  return pairs;
}

/**
 * Pairs each of `next`'s blocks with the `base` block it is, by index: a
 * block whose ID the file wrote is the base block with that ID; then
 * blocks with the same content, in order; then, between those, blocks of
 * the same type in the same place, which are a block edited.
 */
function pairBlocks(base: readonly Block[], next: readonly Block[], written: ReadonlySet<BlockId>) {
  const pairs = new Map<number, number>();
  const used = new Set<number>();
  const baseIndex = new Map(base.map((block, index) => [block.id, index]));
  next.forEach((block, index) => {
    const at = written.has(block.id) ? baseIndex.get(block.id) : undefined;
    if (at !== undefined && !used.has(at)) {
      pairs.set(index, at);
      used.add(at);
    }
  });
  // A block whose file writes an ID of its own keeps it, for the links that name it.
  const freeNext = next.flatMap((block, index) =>
    pairs.has(index) || written.has(block.id) ? [] : [index],
  );
  const freeBase = base.flatMap((_, index) => (used.has(index) ? [] : [index]));
  const content = (blocks: readonly Block[], index: number) =>
    fingerprint(blocks[index] as ContentBlock);
  for (const [i, j] of commonRun(
    freeBase.map((index) => content(base, index)),
    freeNext.map((index) => content(next, index)),
    (key) => key,
  )) {
    const b = freeBase[i];
    const n = freeNext[j];
    if (b === undefined || n === undefined) continue;
    pairs.set(n, b);
    used.add(b);
  }
  // Between paired blocks, the unpaired ones of the same type, in order, are edits.
  let lastBase = -1;
  let pending: number[] = [];
  const flush = (untilBase: number) => {
    let candidate = lastBase + 1;
    for (const n of pending) {
      while (candidate < untilBase && used.has(candidate)) candidate++;
      const block = next[n];
      const before = base[candidate];
      if (candidate < untilBase && block !== undefined && before?.type === block.type) {
        pairs.set(n, candidate);
        used.add(candidate);
        candidate++;
      }
    }
    pending = [];
  };
  next.forEach((block, index) => {
    const at = pairs.get(index);
    if (at === undefined) {
      if (!written.has(block.id)) pending.push(index);
      return;
    }
    flush(at);
    lastBase = at;
  });
  flush(base.length);
  return pairs;
}

/** `next`'s blocks with the IDs of the `base` blocks they are, children too; `ids` records each change. */
function withBaseIds(
  base: readonly Block[],
  next: readonly Block[],
  written: ReadonlySet<BlockId>,
  ids: Map<BlockId, BlockId>,
): Block[] {
  const pairs = pairBlocks(base, next, written);
  const taken = new Set([...pairs.values()].map((index) => base[index]?.id));
  return next.map((block, index) => {
    const at = pairs.get(index);
    const match = at === undefined ? undefined : base[at];
    // A new block keeps its own ID, unless a matched one has it.
    const id = match?.id ?? (taken.has(block.id) ? newBlockId() : block.id);
    if (id !== block.id) ids.set(block.id, id);
    const children = childrenOf(block);
    const renamed = { ...block, id };
    if (children.length === 0) return renamed;
    return {
      ...renamed,
      children: withBaseIds(match === undefined ? [] : childrenOf(match), children, written, ids),
    } as Block;
  });
}

/**
 * A parse of a note's file with the IDs of the `base` blocks its blocks
 * are: by the ID the file wrote, by content, or as an edit of the block in
 * that place. Its source map follows, so the next write keeps the bytes of
 * every block that did not change.
 */
export function alignBlocks(parsed: ParsedMarkdown, base: readonly ContentBlock[]): ParsedMarkdown {
  const ids = new Map<BlockId, BlockId>();
  const content = withBaseIds(base, parsed.content, parsed.writtenIds, ids) as ContentBlock[];
  if (ids.size === 0) return parsed;
  return {
    ...parsed,
    content,
    source: {
      ...parsed.source,
      blocks: parsed.source.blocks.map((block) => ({
        ...block,
        id: ids.get(block.id) ?? block.id,
      })),
    },
  };
}

/** A copy of a block with new IDs for it and its children, to stand beside the original. */
function copied(block: Block, newId: () => BlockId): Block {
  const children = childrenOf(block);
  return {
    ...block,
    id: newId(),
    ...(children.length === 0 ? {} : { children: children.map((child) => copied(child, newId)) }),
  } as Block;
}

/**
 * Merges another app's edit to a note's file into the note. `base` is the
 * note as Nether last wrote or read the file, `ours` the note now, and
 * `theirs` the file now, aligned to `base`. A block changed on one side
 * takes that change; a block one side deleted goes, unless the other side
 * changed it; a block both sides changed keeps ours, with theirs after it
 * under a new ID; and blocks either side added stay, theirs after the
 * block they follow in the file. Nothing either side wrote is lost.
 */
export function mergeBlocks(
  base: readonly ContentBlock[],
  ours: readonly ContentBlock[],
  theirs: readonly ContentBlock[],
  newId: () => BlockId,
): ContentBlock[] {
  const baseById = new Map(base.map((block) => [block.id, fingerprint(block)]));
  const oursById = new Map(ours.map((block) => [block.id, block]));
  const theirsById = new Map(theirs.map((block) => [block.id, block]));
  const changed = (block: ContentBlock | undefined) =>
    block !== undefined && baseById.get(block.id) !== fingerprint(block);

  const result: ContentBlock[] = [];
  for (const block of ours) {
    const fromBase = baseById.has(block.id);
    const their = theirsById.get(block.id);
    if (!fromBase) {
      result.push(block);
    } else if (their === undefined) {
      // They deleted it: it goes, unless we changed it.
      if (changed(block)) result.push(block);
    } else if (!changed(their)) {
      result.push(block);
    } else if (!changed(block) || fingerprint(block) === fingerprint(their)) {
      result.push(their);
    } else {
      result.push(block, copied(their, newId) as ContentBlock);
    }
  }

  // Their new blocks, and blocks we deleted that they changed, go after the
  // block before them in the file that the result has.
  const placed = new Set(result.map((block) => block.id));
  let anchor: BlockId | undefined;
  const insertions: { after: BlockId | undefined; block: ContentBlock }[] = [];
  for (const block of theirs) {
    const fromBase = baseById.has(block.id);
    const deletedByUs = fromBase && !oursById.has(block.id);
    if (!fromBase || (deletedByUs && changed(block))) {
      insertions.push({ after: anchor, block });
      continue;
    }
    if (placed.has(block.id)) anchor = block.id;
  }
  // Insert from the last, so each goes right after its anchor and before later ones.
  let lastAnchor: BlockId | undefined | null = null;
  let offset = 0;
  for (const { after, block } of insertions) {
    if (after !== lastAnchor) {
      lastAnchor = after;
      offset = after === undefined ? 0 : result.findIndex((item) => item.id === after) + 1;
    }
    const id = oursById.has(block.id) || placed.has(block.id) ? newId() : block.id;
    result.splice(offset, 0, id === block.id ? block : (copied(block, newId) as ContentBlock));
    offset++;
  }
  return result;
}
