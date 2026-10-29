import { describe, expect, it } from "vitest";
import {
  type JsonValue,
  type PropertyType,
  checkPropertyValue,
  isPropertyKey,
} from "../src/index.ts";
import { readPropertyDefinition, readPropertyEntries } from "../src/properties.ts";
import { ids } from "./fixtures.ts";

describe("isPropertyKey", () => {
  it("accepts frontmatter keys", () => {
    for (const key of ["status", "due date", "Café", "x".repeat(256)])
      expect(isPropertyKey(key)).toBe(true);
  });

  it("rejects empty, padded, multi-line, too long and $-prefixed keys", () => {
    for (const key of ["", " status", "status ", "a\nb", "x".repeat(257), "$title"]) {
      expect(isPropertyKey(key)).toBe(false);
    }
  });
});

describe("checkPropertyValue", () => {
  const fits: [PropertyType, JsonValue][] = [
    ["text", "Hello"],
    ["number", -2.5],
    ["select", "Done"],
    ["multiSelect", ["a", "b"]],
    ["multiSelect", []],
    ["date", "2026-11-06"],
    ["date", "2026-11-06T09:30"],
    ["checkbox", false],
    ["url", "https://example.com/a?b=c"],
    ["url", "mailto:someone@example.com"],
    ["person", ["fzn0x"]],
    ["relation", [ids.other]],
    ["file", ["attachments/spec.pdf"]],
  ];
  it.each(fits)("accepts a %s value", (type, value) => {
    expect(() => {
      checkPropertyValue(type, value, "value");
    }).not.toThrow();
  });

  it("accepts null, an empty value, for every type", () => {
    for (const type of ["text", "number", "relation", "checkbox"] as const) {
      expect(() => {
        checkPropertyValue(type, null, "value");
      }).not.toThrow();
    }
  });

  const misfits: [PropertyType, JsonValue][] = [
    ["text", 3],
    ["number", "3"],
    ["select", ["Done"]],
    ["multiSelect", ["a", ""]],
    ["multiSelect", "a"],
    ["date", "2026-02-30"],
    ["date", 20261106],
    ["checkbox", "true"],
    ["url", "example.com"],
    ["url", "https://exa mple.com"],
    ["person", [""]],
    ["relation", ["Weekly review"]],
    ["file", "spec.pdf"],
  ];
  it.each(misfits)("rejects %s value %j", (type, value) => {
    expect(() => {
      checkPropertyValue(type, value, "row.value");
    }).toThrow(`row.value does not fit a ${type} property`);
  });
});

describe("property definitions", () => {
  it("give select properties an empty option list by default", () => {
    expect(readPropertyDefinition({ key: "status", type: "select" }, "p")).toEqual({
      key: "status",
      type: "select",
      options: [],
    });
  });

  it("keep a relation's database and backlink", () => {
    const relation = { database: ids.database, backlink: "blocked by" };
    expect(readPropertyDefinition({ key: "blocks", type: "relation", relation }, "p")).toEqual({
      key: "blocks",
      type: "relation",
      relation,
    });
  });

  it.each([
    [{ key: "$x", type: "text" }, "p.key must be a property key"],
    [{ key: "x", type: "formula" }, "p.type must be one of"],
    [{ key: "x", type: "text", options: [] }, "p.options is only for select properties"],
    [
      { key: "x", type: "select", relation: { database: ids.database } },
      "p.relation is only for relation",
    ],
    [
      { key: "x", type: "text", relation: { database: ids.database } },
      "p.relation is only for relation",
    ],
    [{ key: "x", type: "relation" }, "p.relation is missing"],
    [
      { key: "x", type: "relation", relation: { database: "Projects" } },
      "p.relation.database must be a note ID",
    ],
    [
      { key: "x", type: "select", options: [{ name: "A" }, { name: "A" }] },
      'p.options[1].name repeats the option "A"',
    ],
    [
      { key: "x", type: "select", options: [{ name: "A", color: "teal" }] },
      "p.options[0].color must be one of",
    ],
    [{ key: "x", type: "select", options: [{ name: " " }] }, "p.options[0].name must not be empty"],
  ])("rejects %j", (definition, message) => {
    expect(() => readPropertyDefinition(definition, "p")).toThrow(message);
  });
});

describe("property entries", () => {
  it("keep their order and read a missing value as null", () => {
    expect(readPropertyEntries([{ key: "b", value: 1 }, { key: "a" }], "props")).toEqual([
      { key: "b", value: 1 },
      { key: "a", value: null },
    ]);
  });

  it("reject repeated keys and values JSON cannot hold", () => {
    expect(() => readPropertyEntries([{ key: "a" }, { key: "a" }], "props")).toThrow(
      'props[1].key repeats the property "a"',
    );
    expect(() => readPropertyEntries([{ key: "a", value: Number.NaN }], "props")).toThrow(
      "props[0].value must be a finite number",
    );
    expect(() => readPropertyEntries([{ key: "a", value: new Date(0) }], "props")).toThrow(
      "props[0].value must be a plain object",
    );
    expect(() => readPropertyEntries([{ key: "a", value: () => 1 }], "props")).toThrow(
      "props[0].value must be a JSON object",
    );
  });
});
