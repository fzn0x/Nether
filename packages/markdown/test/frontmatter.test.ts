import { describe, expect, it } from "vitest";
import { readFrontmatter, writeFrontmatter } from "../src/index.ts";

describe("readFrontmatter", () => {
  it("reads every YAML value as JSON, in key order", () => {
    expect(
      readFrontmatter(
        [
          "title: Weekly",
          "count: 3",
          "ratio: 0.5",
          "big: 12345678901234567890",
          "infinite: .inf",
          "nothing:",
          "done: false",
          "date: 2026-11-06",
          "list: [a, 1, true]",
          "nested:",
          "  a: 1",
          "  b: [x]",
          "2026: year key",
        ].join("\n"),
      ).properties,
    ).toEqual([
      { key: "title", value: "Weekly" },
      { key: "count", value: 3 },
      { key: "ratio", value: 0.5 },
      { key: "big", value: 12345678901234567000 },
      { key: "infinite", value: "Infinity" },
      { key: "nothing", value: null },
      { key: "done", value: false },
      { key: "date", value: "2026-11-06" },
      { key: "list", value: ["a", 1, true] },
      { key: "nested", value: { a: 1, b: ["x"] } },
      { key: "2026", value: "year key" },
    ]);
  });

  it("reads an empty frontmatter as no properties", () => {
    expect(readFrontmatter("")).toEqual({ properties: [] });
    expect(readFrontmatter("# only a comment")).toEqual({ properties: [] });
  });

  it("leaves out keys Nether cannot use, and keys that are not text", () => {
    expect(readFrontmatter("$x: 1\n[a, b]: 2\nok: 3").properties).toEqual([
      { key: "ok", value: 3 },
    ]);
  });

  it("reports YAML that is not a list of keys and values", () => {
    expect(readFrontmatter("- a\n- b").error).toBe(
      "The frontmatter must be a list of keys and values.",
    );
    expect(readFrontmatter("a: 1\na: 2").error).toBeDefined();
    expect(readFrontmatter("a: [1").error).toBeDefined();
  });

  it("follows aliases without letting them grow without end", () => {
    expect(readFrontmatter("a: &x [1, 2]\nb: *x").properties).toEqual([
      { key: "a", value: [1, 2] },
      { key: "b", value: [1, 2] },
    ]);
  });
});

describe("writeFrontmatter", () => {
  // YAML 1.2, as Obsidian's parser reads it: `yes` is text, not true.
  it("writes new properties as YAML Obsidian reads", () => {
    expect(
      writeFrontmatter(
        undefined,
        [],
        [
          { key: "tags", value: ["a", "b"] },
          { key: "due", value: "2026-11-06" },
          { key: "count", value: 2 },
          { key: "text", value: "yes" },
          { key: "nested", value: { a: null } },
        ],
      ),
    ).toBe("tags:\n  - a\n  - b\ndue: 2026-11-06\ncount: 2\ntext: yes\nnested:\n  a: null\n");
  });

  it("keeps lists flush with their key when the file wrote them so", () => {
    const yaml = "aliases:\n- One\ntitle: A";
    expect(
      writeFrontmatter(
        yaml,
        [
          { key: "aliases", value: ["One"] },
          { key: "title", value: "A" },
        ],
        [
          { key: "aliases", value: ["One", "Two"] },
          { key: "title", value: "A" },
        ],
      ),
    ).toBe("aliases:\n- One\n- Two\ntitle: A\n");
  });

  it("keeps a frontmatter that only holds comments", () => {
    expect(writeFrontmatter("# keep me", [], [])).toBe("# keep me\n");
    expect(writeFrontmatter("a: 1", [{ key: "a", value: 1 }], [])).toBeUndefined();
  });

  it("follows the order of the properties it is given", () => {
    expect(
      writeFrontmatter(
        "a: 1 # first\nb: 2",
        [
          { key: "a", value: 1 },
          { key: "b", value: 2 },
        ],
        [
          { key: "b", value: 2 },
          { key: "a", value: 1 },
        ],
      ),
    ).toBe("b: 2\na: 1 # first\n");
  });
});
