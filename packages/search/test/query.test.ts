// A search as typed: words, phrases, exclusions and filters, and the FTS5
// expression the index runs.
import { describe, expect, it } from "vitest";
import { foldText, ftsMatch, isEmptyQuery, parseQuery } from "../src/index.ts";

describe("parseQuery", () => {
  it("reads words, phrases and exclusions", () => {
    expect(parseQuery(' road  "next steps" -draft -"old plan" ')).toEqual({
      words: ["road"],
      phrases: ["next steps"],
      excluded: ["draft", "old plan"],
      filters: [],
      excludedFilters: [],
    });
  });

  it("reads tag, path and property filters, each maybe excluded", () => {
    const query = parseQuery(
      'tag:project #area/work -tag:done path:Projects/ path:"Daily notes" prop:status=done [due] -[owner:me] plan',
    );
    expect(query.words).toEqual(["plan"]);
    expect(query.filters).toEqual([
      { kind: "tag", tag: "project" },
      { kind: "tag", tag: "area/work" },
      { kind: "path", path: "Projects/" },
      { kind: "path", path: "Daily notes" },
      { kind: "prop", key: "status", value: "done" },
      { kind: "prop", key: "due" },
    ]);
    expect(query.excludedFilters).toEqual([
      { kind: "tag", tag: "done" },
      { kind: "prop", key: "owner", value: "me" },
    ]);
  });

  it("keeps unknown or empty filters, a lone dash, and an open quote as text", () => {
    expect(parseQuery('color:red tag: - "open').words).toEqual(["color:red", "tag:"]);
    expect(parseQuery('"open').phrases).toEqual(["open"]);
    expect(isEmptyQuery(parseQuery("  "))).toBe(true);
    expect(isEmptyQuery(parseQuery("tag:a"))).toBe(false);
  });
});

describe("ftsMatch", () => {
  it("requires every word and phrase, the last word as a prefix", () => {
    expect(ftsMatch(parseQuery('road map "next steps"'))).toBe(
      '"road" AND "map"* AND "next steps"',
    );
    expect(ftsMatch(parseQuery("road map"), false)).toBe('"road" AND "map"');
  });

  it("leaves excluded ones out, and quotes what FTS5 would read as syntax", () => {
    expect(ftsMatch(parseQuery('a -b -"c d"'))).toBe('"a"* NOT ("b" OR "c d")');
    expect(ftsMatch(parseQuery('say"hi" OR'))).toBe('"say""hi""" AND "OR"*');
    expect(ftsMatch(parseQuery("tag:x -y"))).toBeUndefined();
  });
});

describe("foldText", () => {
  it("folds case and accents as the index does", () => {
    expect(foldText("Café ÉTÉ naïve")).toBe("cafe ete naive");
  });
});
