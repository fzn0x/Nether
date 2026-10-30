// A note read again from its file keeps the IDs Nether knows, and another
// app's edit merges into the note with nothing either side wrote lost:
// examples, and random edits on both sides at once.
import type { BlockId, ContentBlock, Inline } from "@nether/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { alignBlocks, mergeBlocks, parseMarkdown, serializeMarkdown } from "../src/index.ts";

const runs = Number(process.env.PROPERTY_RUNS ?? 300);

function ids(blocks: readonly ContentBlock[]): string[] {
  return blocks.map((block) => block.id);
}

function texts(blocks: readonly ContentBlock[]): string[] {
  return blocks.map((block) => {
    if (!("content" in block) || !Array.isArray(block.content)) return block.type;
    const inlines = block.content as readonly Inline[];
    return inlines.map((inline) => (inline.type === "text" ? inline.text : "")).join("");
  });
}

describe("alignBlocks", () => {
  const before = "# Plan\n\nFirst.\n\nSecond.\n\n- one\n- two\n    - nested\n\nLast.\n";

  it("keeps the IDs of blocks that did not change, or changed in place", () => {
    const base = parseMarkdown(before);
    const after = "# Plan\n\nFirst, edited.\n\nNew.\n\nSecond.\n\n- one\n- two\n    - nested\n";
    const aligned = alignBlocks(parseMarkdown(after), base.content);
    const [heading, first, added, second, one, two] = aligned.content;
    expect(heading?.id).toBe(base.content[0]?.id);
    expect(first?.id).toBe(base.content[1]?.id);
    expect(second?.id).toBe(base.content[2]?.id);
    expect(one?.id).toBe(base.content[3]?.id);
    expect(two?.id).toBe(base.content[4]?.id);
    // The nested item keeps its ID too.
    const baseNested = (base.content[4] as { children?: ContentBlock[] }).children?.[0]?.id;
    expect((two as { children?: ContentBlock[] }).children?.[0]?.id).toBe(baseNested);
    expect(ids(base.content)).not.toContain(added?.id);
    // "Last." was deleted, and no two blocks share an ID.
    expect(new Set(ids(aligned.content)).size).toBe(aligned.content.length);
  });

  it("keeps the bytes of the file when it writes the aligned note back", () => {
    const base = parseMarkdown(before);
    const after = "# Plan\n\n*   First,   spaced.\n\nSecond.\n\nLast.\n";
    const aligned = alignBlocks(parseMarkdown(after), base.content);
    const written = serializeMarkdown(
      { properties: aligned.properties, content: aligned.content },
      { source: aligned.source },
    );
    expect(written.text).toBe(after);
  });

  it("matches a block by the ID the file wrote, wherever it moved", () => {
    const base = parseMarkdown("Alpha ^a1\n\nBeta.\n");
    const aligned = alignBlocks(parseMarkdown("Beta.\n\nAlpha moved ^a1\n"), base.content);
    expect(ids(aligned.content)).toEqual([base.content[1]?.id, "a1"]);
  });

  it("keeps an ID a block's file now writes, rather than the one the note knew", () => {
    const base = parseMarkdown("Alpha.\n\nBeta.\n");
    const aligned = alignBlocks(parseMarkdown("Alpha. ^a1\n\nBeta.\n"), base.content);
    expect(ids(aligned.content)).toEqual(["a1", base.content[1]?.id]);
  });

  it("gives a new block a new ID when its own is taken", () => {
    const base = [{ id: "x" as BlockId, type: "paragraph", content: [] }] as ContentBlock[];
    const parsed = parseMarkdown("One.\n\nTwo.\n", { newId: () => "x" as BlockId });
    const aligned = alignBlocks(parsed, base);
    expect(new Set(ids(aligned.content)).size).toBe(2);
  });
});

describe("mergeBlocks", () => {
  let next = 0;
  const newId = () => `m${String(next++)}` as BlockId;
  const paragraph = (id: string, text: string): ContentBlock => ({
    id: id as BlockId,
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const base = [paragraph("a", "A"), paragraph("b", "B"), paragraph("c", "C")];

  it("takes each side's changes to different blocks", () => {
    const ours = [paragraph("a", "A ours"), paragraph("b", "B"), paragraph("c", "C")];
    const theirs = [paragraph("a", "A"), paragraph("b", "B theirs"), paragraph("t", "T")];
    expect(texts(mergeBlocks(base, ours, theirs, newId))).toEqual(["A ours", "B theirs", "T"]);
  });

  it("keeps both versions of a block both sides changed", () => {
    const ours = [paragraph("a", "A ours"), paragraph("b", "B"), paragraph("c", "C")];
    const theirs = [paragraph("a", "A theirs"), paragraph("b", "B"), paragraph("c", "C")];
    const merged = mergeBlocks(base, ours, theirs, newId);
    expect(texts(merged)).toEqual(["A ours", "A theirs", "B", "C"]);
    expect(new Set(ids(merged)).size).toBe(4);
  });

  it("keeps a block one side deleted and the other changed", () => {
    const ours = [paragraph("b", "B"), paragraph("c", "C ours")];
    const theirs = [paragraph("a", "A theirs"), paragraph("b", "B")];
    expect(texts(mergeBlocks(base, ours, theirs, newId))).toEqual(["A theirs", "B", "C ours"]);
  });

  it("puts their new blocks after the block they follow, and ours where they are", () => {
    const ours = [paragraph("o", "O"), ...base];
    const theirs = [
      paragraph("a", "A"),
      paragraph("t1", "T1"),
      paragraph("t2", "T2"),
      base[1],
      base[2],
    ];
    expect(texts(mergeBlocks(base, ours, theirs as ContentBlock[], newId))).toEqual([
      "O",
      "A",
      "T1",
      "T2",
      "B",
      "C",
    ]);
  });

  it("loses nothing either side wrote, whatever the edits", () => {
    interface Edit {
      kind: "insert" | "delete" | "change";
      at: number;
    }
    const edit = fc.record({
      kind: fc.constantFrom<"insert" | "delete" | "change">("insert", "delete", "change"),
      at: fc.nat(20),
    });

    /** Applies edits to a copy of `blocks`, each written text unique to its side. */
    function apply(blocks: readonly ContentBlock[], edits: readonly Edit[], side: string) {
      const out = [...blocks];
      edits.forEach(({ kind, at }, step) => {
        const index = out.length === 0 ? 0 : at % (out.length + (kind === "insert" ? 1 : 0));
        const text = `${side} ${String(step)}`;
        if (kind === "insert") out.splice(index, 0, paragraph(`${side}${String(step)}`, text));
        else if (out.length > 0 && kind === "delete") out.splice(index, 1);
        else if (out[index] !== undefined) out[index] = paragraph(out[index].id, text);
      });
      return out;
    }

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.array(edit, { maxLength: 8 }),
        fc.array(edit, { maxLength: 8 }),
        (size, ourEdits, theirEdits) => {
          const start = Array.from({ length: size }, (_, index) =>
            paragraph(`b${String(index)}`, `base ${String(index)}`),
          );
          const ours = apply(start, ourEdits, "ours");
          const theirs = apply(start, theirEdits, "theirs");
          const merged = mergeBlocks(start, ours, theirs, newId);
          const result = texts(merged);
          const baseText = new Map(start.map((block) => [block.id, texts([block])[0]]));
          const ourText = new Map(ours.map((block) => [block.id, texts([block])[0]]));
          const theirText = new Map(theirs.map((block) => [block.id, texts([block])[0]]));

          // Every text either side wrote is there.
          for (const text of [...ourText.values(), ...theirText.values()]) {
            if (!text?.startsWith("base")) expect(result).toContain(text);
          }
          for (const [id, text] of baseText) {
            const ourVersion = ourText.get(id);
            const theirVersion = theirText.get(id);
            const keptByBoth = ourVersion === text && theirVersion === text;
            // A block neither side touched stays; one deleted and not changed goes.
            if (keptByBoth) expect(result).toContain(text);
            if (
              (ourVersion === undefined && theirVersion === text) ||
              (theirVersion === undefined && ourVersion === text)
            ) {
              expect(result).not.toContain(text);
            }
          }
          // No two blocks share an ID, and ours keep their order.
          expect(new Set(ids(merged)).size).toBe(merged.length);
          const mergedIds = ids(merged);
          const order = ids(ours).filter((id) => mergedIds.includes(id));
          expect(mergedIds.filter((id) => order.includes(id))).toEqual(order);
        },
      ),
      { numRuns: runs },
    );
  });
});
