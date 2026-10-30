// Random notes, written as Markdown and read back. Each property runs a few
// hundred notes made of every block and inline type, with text full of the
// characters Markdown and Obsidian give meaning to.
import type { ContentBlock, Inline, Mark } from "@nether/core";
import { markTypes } from "@nether/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src/index.ts";
import { trimEdges } from "../src/to-markdown.ts";
import { shapes } from "./helpers.ts";

// These strings are ASCII, so splitting them into code units is safe.
const chars = (value: string): string[] => value.split("");
const alphabet = [
  ...chars("abcdefghij"),
  ...chars("ABZ019"),
  " ",
  ...chars("*_[]()#!=%$^`~<>|&\\-+.:/'\""),
  "é",
  "中",
  "😀",
];
const textChars = fc.constantFrom(...alphabet, "\n");
// Known limit: a backslash right before white space that ends up encoded, as
// the space at the end of bold text, reads back as an escape. Text here has
// no backslash before white space.
const noBackslashBeforeSpace = (value: string): string => value.replace(/\\(?=\s|$)/g, "/");
const lineText = fc
  .string({ unit: fc.constantFrom(...alphabet), minLength: 1, maxLength: 12 })
  .map(noBackslashBeforeSpace);
const anyText = fc
  .string({ unit: textChars, minLength: 1, maxLength: 14 })
  .map(noBackslashBeforeSpace);
const word = fc.string({
  unit: fc.constantFrom(...chars("abcdefghijklmnop")),
  minLength: 1,
  maxLength: 8,
});
const name = fc
  .string({ unit: fc.constantFrom(...chars("abcdefgh XYZ019-.")), minLength: 1, maxLength: 10 })
  .filter((value) => value.trim() !== "" && value.trim() === value);

const markArbitrary: fc.Arbitrary<Mark> = fc.oneof(
  fc.constantFrom<Mark>(
    { type: "bold" },
    { type: "italic" },
    { type: "strike" },
    { type: "highlight" },
    { type: "underline" },
    { type: "code" },
  ),
  fc.constantFrom<Mark>(
    { type: "link", href: "https://example.com/a" },
    { type: "link", href: "notes/b.md", title: "B" },
  ),
);

function normalizeMarks(marks: readonly Mark[]): Mark[] {
  const seen = new Set<string>();
  return [...marks]
    .filter((mark) => !seen.has(mark.type) && Boolean(seen.add(mark.type)))
    .sort((a, b) => markTypes.indexOf(a.type) - markTypes.indexOf(b.type));
}

const inlineArbitrary: fc.Arbitrary<Inline> = fc
  .oneof(
    {
      weight: 6,
      arbitrary: fc.record({ text: anyText, marks: fc.array(markArbitrary, { maxLength: 3 }) }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ comment: lineText.filter((value) => !value.includes("%")) }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        link: name,
        alias: fc.option(name, { nil: undefined }),
        heading: fc.option(name, { nil: undefined }),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ tag: fc.constantFrom("tag", "area/research", "déjà-vu", "a_b") }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        latex: fc.constantFrom("x^2", "\\frac{a}{b}", "a \\$ b", "e^{i\\pi}"),
      }),
    },
    { weight: 1, arbitrary: fc.constant({ break: true }) },
  )
  .map((value): Inline => {
    if ("text" in value) {
      const marks = normalizeMarks(value.marks);
      // Code spans hold one line: a line break in one reads back as a space.
      // Known limit: a paragraph that opens with a link around code holding
      // `]:`, as [`]:a`](url), reads as a link definition, and code cannot be
      // escaped; code here holds no `]:`.
      if (marks.some((mark) => mark.type === "code")) {
        return {
          type: "text",
          text: value.text.replace(/\n/g, " ").replace(/\]:/g, "]-"),
          marks,
        };
      }
      return marks.length === 0
        ? { type: "text", text: value.text }
        : { type: "text", text: value.text, marks };
    }
    if ("comment" in value)
      return { type: "text", text: value.comment, marks: [{ type: "comment" }] };
    if ("link" in value) {
      return {
        type: "wikiLink",
        target:
          value.heading === undefined
            ? { title: value.link }
            : { title: value.link, heading: value.heading },
        ...(value.alias === undefined ? {} : { alias: value.alias }),
      };
    }
    if ("tag" in value) return { type: "tag", name: value.tag };
    if ("latex" in value) return { type: "math", latex: value.latex };
    return { type: "hardBreak" };
  });

function sameMarks(a: readonly Mark[] = [], b: readonly Mark[] = []): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Inline content as the parser gives it: adjacent text with the same marks
 * merged and no break at either end. It also leaves out what Markdown cannot
 * hold apart, as the editor's input rules do: a tag follows a word and a
 * space with its own marks, and formatting right after it needs a space
 * between, since `#tag**-**` reads as a tag and text; two maths side by side,
 * `$a$$b$`, read as one.
 *
 * Known limit: bold or italic that ends in a space, then a space and a tag,
 * writes the space before the tag as `&#x20;` (mdast-util-to-markdown encodes
 * both spaces), and the tag reads back as text.
 */
function normalizeInlines(inlines: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  const push = (inline: Inline): void => {
    const last = out[out.length - 1];
    if (inline.type === "text" && last?.type === "text" && sameMarks(last.marks, inline.marks)) {
      out[out.length - 1] = { ...last, text: last.text + inline.text };
    } else {
      out.push(inline);
    }
  };
  const attention = (inline: Inline): boolean =>
    inline.type === "text" &&
    (inline.marks ?? []).some((mark) =>
      ["bold", "italic", "strike", "highlight"].includes(mark.type),
    );
  for (const inline of inlines) {
    const before = out[out.length - 1];
    if (inline.type === "math" && before?.type === "math") push({ type: "text", text: " " });
    if (before?.type === "tag" && attention(inline)) push({ type: "text", text: " " });
    if (inline.type === "tag" && before !== undefined && before.type !== "hardBreak") {
      const spaced =
        before.type === "text" &&
        sameMarks(before.marks, inline.marks) &&
        /\S\s$/.test(before.text);
      if (!spaced)
        push({ type: "text", text: "x ", ...(inline.marks ? { marks: inline.marks } : {}) });
    }
    push(inline);
  }
  while (out[0]?.type === "hardBreak") out.shift();
  while (out[out.length - 1]?.type === "hardBreak") out.pop();
  return out;
}

const inlines = fc
  .array(inlineArbitrary, { minLength: 1, maxLength: 6 })
  .map(normalizeInlines)
  .filter((value) => value.length > 0);
/** Inline content on one line: no line breaks. */
const lineInlines = inlines
  .map((value) =>
    normalizeInlines(
      value
        .filter((inline) => inline.type !== "hardBreak")
        .map((inline) =>
          inline.type === "text" ? { ...inline, text: inline.text.replace(/\n/g, " ") } : inline,
        ),
    ),
  )
  .filter((value) => value.length > 0);

/**
 * One line whose unmarked edge space does not stay: a table cell, which GFM
 * trims, or a callout title. In a cell GFM reads `\|` as a pipe even in code,
 * so code and comments there hold no backslash before a pipe.
 */
const cellInlines = lineInlines.map((value) => {
  const out = value.map((inline) =>
    inline.type === "text" && inline.marks !== undefined
      ? { ...inline, text: inline.text.replace(/\\\|/g, "/|") }
      : inline,
  );
  const first = out[0];
  if (first?.type === "text" && first.marks === undefined) {
    out[0] = { ...first, text: first.text.trimStart() };
  }
  const last = out[out.length - 1];
  if (last?.type === "text" && last.marks === undefined) {
    out[out.length - 1] = { ...last, text: last.text.trimEnd() };
  }
  return out.filter((inline) => inline.type !== "text" || inline.text !== "");
});

/** A callout's title, which the writer trims at both ends, marked or not. */
const titleInlines = cellInlines.map(trimEdges).filter((value) => value.length > 0);

type Draft = Record<string, unknown> & { type: string };

const leafBlock: fc.Arbitrary<Draft> = fc.oneof(
  { weight: 5, arbitrary: inlines.map((content) => ({ type: "paragraph", content })) },
  {
    weight: 2,
    arbitrary: fc
      .record({ level: fc.integer({ min: 1, max: 6 }), content: lineInlines })
      .map(({ level, content }) => ({ type: "heading", attrs: { level }, content })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({
        language: fc.constantFrom("", "ts", "mermaid", "js title=a.js"),
        text: fc.string({ unit: textChars, maxLength: 20 }),
      })
      .map(({ language, text }) => ({ type: "code", attrs: { language }, text })),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom("x^2", "\\sum_{n} n", "a\n= b")
      .map((text) => ({ type: "math", text })),
  },
  { weight: 1, arbitrary: fc.constant({ type: "divider" }) },
  {
    weight: 1,
    arbitrary: fc
      .record({
        columns: fc.integer({ min: 1, max: 3 }),
        rows: fc.integer({ min: 1, max: 3 }),
        align: fc.array(fc.constantFrom("left", "center", "right", null), {
          minLength: 3,
          maxLength: 3,
        }),
        cells: fc.array(fc.option(cellInlines, { nil: undefined }), { minLength: 9, maxLength: 9 }),
      })
      .map(({ columns, rows, align, cells }) => ({
        type: "table",
        attrs: { header: true, align: align.slice(0, columns) },
        children: Array.from({ length: rows }, (_, row) => ({
          type: "tableRow",
          children: Array.from({ length: columns }, (_, column) => ({
            type: "tableCell",
            content: cells[row * 3 + column] ?? [],
          })),
        })),
      })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({
        src: fc.constantFrom("a.png", "dir/b c.jpg", "https://x.com/i.png"),
        alt: fc.option(word, { nil: undefined }),
        width: fc.option(fc.integer({ min: 1, max: 900 }), { nil: undefined }),
      })
      .map(({ src, alt, width }) => ({
        type: "image",
        attrs: {
          src,
          ...(alt === undefined ? {} : { alt }),
          ...(width === undefined ? {} : { width }),
        },
      })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({ title: name, alias: fc.option(fc.constantFrom("300", "a b"), { nil: undefined }) })
      .map(({ title, alias }) => ({
        type: "embed",
        attrs: { target: { title }, ...(alias === undefined ? {} : { alias }) },
      })),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom("https://example.com/post", "http://a.b/c?d=e")
      .map((url) => ({ type: "bookmark", attrs: { url } })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({ src: fc.constantFrom("spec.pdf", "a/talk.mp4"), name: word })
      .map(({ src, name }) => ({ type: "file", attrs: { src, name } })),
  },
);

const blockArbitrary: fc.Arbitrary<Draft> = fc.letrec<{ block: Draft; blocks: Draft[] }>((tie) => ({
  block: fc.oneof(
    { depthSize: "small" },
    { weight: 8, arbitrary: leafBlock },
    {
      weight: 2,
      arbitrary: fc
        .record({
          kind: fc.constantFrom("bulletListItem", "numberedListItem", "taskListItem"),
          content: inlines,
          checked: fc.boolean(),
          children: fc.option(tie("blocks"), { nil: undefined }),
        })
        .map(({ kind, content, checked, children }) => ({
          type: kind,
          content,
          ...(kind === "taskListItem" ? { attrs: { checked } } : {}),
          ...(children === undefined || children.length === 0 ? {} : { children }),
        })),
    },
    { weight: 1, arbitrary: tie("blocks").map((children) => ({ type: "quote", children })) },
    {
      weight: 1,
      arbitrary: fc
        .record({
          kind: fc.constantFrom("note", "tip", "warning"),
          fold: fc.constantFrom(undefined, "open", "closed"),
          title: fc.option(titleInlines, { nil: undefined }),
          children: tie("blocks"),
        })
        .map(({ kind, fold, title, children }) => ({
          type: "callout",
          attrs: fold === undefined ? { kind } : { kind, fold },
          content: title ?? [],
          ...(children.length === 0 ? {} : { children }),
        })),
    },
    {
      weight: 1,
      arbitrary: fc
        .record({ summary: fc.option(word, { nil: undefined }), children: tie("blocks") })
        .map(({ summary, children }) => ({
          type: "toggle",
          content: summary === undefined ? [] : [{ type: "text", text: summary }],
          ...(children.length === 0 ? {} : { children }),
        })),
    },
    {
      weight: 1,
      arbitrary: fc
        .array(
          fc.record({
            width: fc.option(fc.constantFrom(0.25, 0.5, 0.333), { nil: undefined }),
            children: tie("blocks"),
          }),
          { minLength: 2, maxLength: 3 },
        )
        .map((columns) => ({
          type: "columns",
          children: columns.map(({ width, children }) => ({
            type: "column",
            ...(width === undefined ? {} : { attrs: { width } }),
            children,
          })),
        })),
    },
  ),
  blocks: fc.array(tie("block"), { maxLength: 3 }),
})).block;

/** Gives every block a unique ID, as a note's content needs. */
function withIds(drafts: readonly Draft[]): ContentBlock[] {
  let next = 0;
  const visit = (draft: Draft): Draft => {
    const id = `x${String(next++)}`;
    const children = Array.isArray(draft.children)
      ? (draft.children as Draft[]).map(visit)
      : undefined;
    return { ...draft, id, ...(children === undefined ? {} : { children }) };
  };
  return drafts.map(visit) as unknown as ContentBlock[];
}

/** What Markdown cannot hold apart: two lists of one kind side by side are one list; an empty quote has nothing to keep. */
function representable(blocks: readonly ContentBlock[]): boolean {
  const ok = (siblings: readonly ContentBlock[]): boolean =>
    siblings.every((block, index) => {
      if (block.type === "numberedListItem" && block.attrs !== undefined && index > 0) return false;
      if (block.type === "quote" && block.children.length === 0) return false;
      if (
        block.type === "callout" &&
        block.content.length === 0 &&
        block.children?.[0]?.type === "paragraph"
      ) {
        // The body's first line would be read as the title.
        return false;
      }
      if (block.type === "columns" && block.children.some((column) => column.children.length === 0))
        return false;
      return "children" in block && Array.isArray(block.children)
        ? ok(block.children as readonly ContentBlock[])
        : true;
    });
  return ok(blocks);
}

// More runs for a deeper check: PROPERTY_RUNS=3000 pnpm test.
const runs = Number(process.env.PROPERTY_RUNS ?? 300);
// To replay a failure: PROPERTY_SEED=<seed> PROPERTY_PATH=<path> from its report.
const replay =
  process.env.PROPERTY_SEED === undefined
    ? {}
    : {
        seed: Number(process.env.PROPERTY_SEED),
        ...(process.env.PROPERTY_PATH === undefined ? {} : { path: process.env.PROPERTY_PATH }),
      };

const notes = fc
  .array(blockArbitrary, { minLength: 1, maxLength: 5 })
  .map(withIds)
  .filter(representable);

describe("random notes", () => {
  it("read back as the same content after being written anew", () => {
    fc.assert(
      fc.property(notes, (content) => {
        const text = serializeMarkdown({ properties: [], content }).text;
        expect(shapes(parseMarkdown(text).content)).toEqual(shapes(content));
      }),
      { numRuns: runs, ...replay },
    );
  }, 120_000);

  it("write back byte for byte when nothing changed", () => {
    fc.assert(
      fc.property(notes, (content) => {
        const text = serializeMarkdown({ properties: [], content }).text;
        const parsed = parseMarkdown(text);
        expect(serializeMarkdown(parsed, { source: parsed.source }).text).toBe(text);
      }),
      { numRuns: runs, ...replay },
    );
  }, 120_000);

  it("keep every other block's bytes when one block is replaced", () => {
    fc.assert(
      fc.property(notes, fc.nat(), lineText, (content, pick, replacement) => {
        const text = serializeMarkdown({ properties: [], content }).text;
        const parsed = parseMarkdown(text);
        const index = pick % parsed.content.length;
        const edited = parsed.content.map((block, at): ContentBlock =>
          at === index
            ? {
                id: block.id,
                type: "paragraph",
                content: [{ type: "text", text: replacement.trim() || "x" }],
              }
            : block,
        );
        const written = serializeMarkdown(
          { properties: [], content: edited },
          { source: parsed.source },
        );
        const again = parseMarkdown(written.text);
        expect(shapes(again.content)).toEqual(shapes(edited));
        // Every block before the edited one keeps its bytes, from the start of the file.
        const kept = parsed.source.blocks[index]?.start ?? 0;
        expect(written.text.slice(0, kept)).toBe(text.slice(0, kept));
      }),
      { numRuns: runs, ...replay },
    );
  }, 120_000);
});
