import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fingerprint, parseMarkdown, serializeMarkdown } from "../src/index.ts";

const corpus = new URL("./corpus/", import.meta.url);
const files = readdirSync(corpus).filter((name) => name.endsWith(".md"));

function read(name: string): string {
  return readFileSync(new URL(name, corpus), "utf8");
}

/** A note's content without block IDs, to compare two parses. */
function shape(markdown: string): unknown {
  const parsed = parseMarkdown(markdown);
  return {
    properties: parsed.properties,
    content: parsed.content.map((block) => JSON.parse(fingerprint(block)) as unknown),
  };
}

describe.each(files)("%s", (name) => {
  const markdown = read(name);

  it("writes back the same bytes when nothing changed", () => {
    const parsed = parseMarkdown(markdown);
    const written = serializeMarkdown(parsed, {
      source: parsed.source,
      writeIds: parsed.writtenIds,
    });
    expect(written.text).toBe(markdown);
  });

  it("writes every block anew into Markdown that reads back the same", () => {
    const parsed = parseMarkdown(markdown);
    const written = serializeMarkdown(parsed, { writeIds: parsed.writtenIds });
    expect(shape(written.text)).toEqual(shape(markdown));
  });

  it("is stable: writing anew twice gives the same text", () => {
    const parsed = parseMarkdown(markdown);
    const once = serializeMarkdown(parsed, { writeIds: parsed.writtenIds }).text;
    const again = parseMarkdown(once);
    expect(serializeMarkdown(again, { writeIds: again.writtenIds }).text).toBe(once);
  });
});
