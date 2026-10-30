// A note's properties in the app: their types, the vault's choice or what
// their values look like, values carried to another type, and new keys.
import { describe, expect, it } from "vitest";
import { convertValue, inferType, isListType, newPropertyKey, typeOf } from "../src/properties.ts";

describe("inferType", () => {
  it("reads a type from what a value looks like, as Obsidian does", () => {
    expect(inferType(true)).toBe("checkbox");
    expect(inferType(3)).toBe("number");
    expect(inferType("2026-10-30")).toBe("date");
    expect(inferType("2026-10-30T15:30:00Z")).toBe("date");
    expect(inferType("https://example.com")).toBe("url");
    expect(inferType("[[Roadmap]]")).toBe("relation");
    expect(inferType(["[[A]]", "[[B]]"])).toBe("relation");
    expect(inferType(["a", "b"])).toBe("multiSelect");
    expect(inferType([])).toBe("multiSelect");
    expect(inferType("plain")).toBe("text");
    expect(inferType(null)).toBe("text");
  });

  it("takes the vault's choice for a key first", () => {
    expect(typeOf("status", "done", { status: "select" })).toBe("select");
    expect(typeOf("count", 3, {})).toBe("number");
  });
});

describe("convertValue", () => {
  it("carries a value to another type as near as it goes", () => {
    expect(convertValue("3.5", "number")).toBe(3.5);
    expect(convertValue("x", "number")).toBeNull();
    expect(convertValue("", "number")).toBeNull();
    expect(convertValue("yes", "checkbox")).toBe(true);
    expect(convertValue("no", "checkbox")).toBe(false);
    expect(convertValue("2026-10-30T10:00", "date")).toBe("2026-10-30");
    expect(convertValue("soon", "date")).toBeNull();
    expect(convertValue("a, b ,", "multiSelect")).toEqual(["a", "b"]);
    expect(convertValue(["a", 2], "relation")).toEqual(["a", "2"]);
    expect(convertValue("", "multiSelect")).toEqual([]);
    expect(convertValue(["a", "b"], "text")).toBe("a, b");
    expect(convertValue({ x: 1 }, "text")).toBe('{"x":1}');
    expect(convertValue(null, "url")).toBe("");
    expect(isListType("relation")).toBe(true);
    expect(isListType("select")).toBe(false);
  });
});

describe("newPropertyKey", () => {
  it("gives a key the note does not have", () => {
    expect(newPropertyKey(["status"])).toBe("property");
    expect(newPropertyKey(["Property", "property 2"])).toBe("property 3");
  });
});
