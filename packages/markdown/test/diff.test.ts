// Line diffs between two versions of a note: examples, and random texts,
// whose diffs give both texts back and change no more lines than needed.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type DiffPart, diffLines, textLines } from "../src/diff.ts";

const side = (parts: readonly DiffPart[], kind: "removed" | "added") =>
  parts.filter((part) => part.kind === "same" || part.kind === kind).flatMap((part) => part.lines);

const changed = (parts: readonly DiffPart[]) =>
  parts
    .filter((part) => part.kind !== "same")
    .reduce((total, part) => total + part.lines.length, 0);

/** The fewest lines to remove and add, from the longest common subsequence. */
function fewest(a: readonly string[], b: readonly string[]): number {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    const row = table[i] ?? [];
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return a.length + b.length - 2 * (table[0]?.[0] ?? 0);
}

describe("textLines", () => {
  it("splits on line breaks of either kind, a last one ending its line", () => {
    expect(textLines("")).toEqual([]);
    expect(textLines("one")).toEqual(["one"]);
    expect(textLines("one\r\ntwo\n")).toEqual(["one", "two"]);
    expect(textLines("one\n\n")).toEqual(["one", ""]);
  });
});

describe("diffLines", () => {
  it("shows the lines removed and added between the lines kept", () => {
    expect(diffLines("# Plan\n\n- one\n- two\n", "# Plan\n\n- one\n- three\n- four\n")).toEqual([
      { kind: "same", lines: ["# Plan", "", "- one"] },
      { kind: "removed", lines: ["- two"] },
      { kind: "added", lines: ["- three", "- four"] },
    ]);
  });

  it("gives one part for texts the same, and the whole of each for texts with nothing alike", () => {
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([{ kind: "same", lines: ["a", "b"] }]);
    expect(diffLines("", "")).toEqual([]);
    expect(diffLines("", "new\n")).toEqual([{ kind: "added", lines: ["new"] }]);
    expect(diffLines("a\nb", "c")).toEqual([
      { kind: "removed", lines: ["a", "b"] },
      { kind: "added", lines: ["c"] },
    ]);
  });

  it("finds the lines kept in the middle of changes", () => {
    const parts = diffLines("x\nkeep\ny\nalso\n", "keep\nz\nalso\nw\n");
    expect(side(parts, "removed")).toEqual(["x", "keep", "y", "also"]);
    expect(side(parts, "added")).toEqual(["keep", "z", "also", "w"]);
    expect(changed(parts)).toBe(4);
  });

  it("gives both texts back, changing no more lines than it must", () => {
    const lines = fc.array(fc.constantFrom("a", "b", "c", "", "- item"), { maxLength: 14 });
    fc.assert(
      fc.property(lines, lines, (a, b) => {
        const text = (of: readonly string[]) => of.map((line) => `${line}\n`).join("");
        const parts = diffLines(text(a), text(b));
        expect(side(parts, "removed")).toEqual(a);
        expect(side(parts, "added")).toEqual(b);
        expect(changed(parts)).toBe(fewest(a, b));
        // No two parts in a row of one kind, and removals before additions.
        for (let index = 1; index < parts.length; index++) {
          expect(parts[index]?.kind).not.toBe(parts[index - 1]?.kind);
          if (parts[index]?.kind === "removed") expect(parts[index - 1]?.kind).toBe("same");
        }
      }),
      { numRuns: 300 },
    );
  });
});
