import type { BlockId, ContentBlock } from "@nether/core";
import { type ParsedMarkdown, fingerprint, parseMarkdown } from "../src/index.ts";

/** Parses with IDs b1, b2 and so on, in the order blocks are made. */
export function parse(markdown: string): ParsedMarkdown {
  let next = 0;
  return parseMarkdown(markdown, {
    newId: (taken) => {
      let id: string;
      do id = `b${String(++next)}`;
      while (taken.has(id));
      return id as BlockId;
    },
  });
}

/** The item at an index, which the test knows is there. */
export function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`Nothing at ${String(index)}.`);
  return item;
}

/** Blocks without their IDs, to compare what they hold. */
export function shapes(blocks: readonly ContentBlock[]): unknown[] {
  return blocks.map((block) => JSON.parse(fingerprint(block)) as unknown);
}

/** The blocks a Markdown text holds, without IDs. */
export function blocksOf(markdown: string): unknown[] {
  return shapes(parse(markdown).content);
}

export function text(value: string, ...marks: string[]): unknown {
  return marks.length === 0
    ? { type: "text", text: value }
    : { type: "text", text: value, marks: marks.map((type) => ({ type })) };
}

export function paragraph(...content: unknown[]): unknown {
  return { type: "paragraph", content };
}
