// Random notes taken to the editor's document and back: every document must
// be valid for the schema, and the blocks must come back the same.
import type { BlockId, ContentBlock, Inline, Mark } from "@nether/core";
import { markTypes, readContent } from "@nether/core";
import { getSchema } from "@tiptap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromEditor, netherExtensions, toEditor } from "../src/index.ts";

const schema = getSchema(netherExtensions());
const runs = Number(process.env.PROPERTY_RUNS ?? 300);

const word = fc.string({
  unit: fc.constantFrom(..."abc xyz-é中😀\n*_[]#=%$".split("")),
  minLength: 1,
  maxLength: 8,
});
const name = fc.constantFrom("Note", "folder/Other note", "a.png");

const markArbitrary: fc.Arbitrary<Mark> = fc.constantFrom<Mark>(
  { type: "bold" },
  { type: "italic" },
  { type: "underline" },
  { type: "strike" },
  { type: "code" },
  { type: "highlight" },
  { type: "comment" },
  { type: "link", href: "https://example.com" },
  { type: "link", href: "b.md", title: "B" },
);

function normalizeMarks(marks: readonly Mark[]): Mark[] | undefined {
  const seen = new Set<string>();
  const out = marks
    .filter((mark) => !seen.has(mark.type) && Boolean(seen.add(mark.type)))
    .sort((a, b) => markTypes.indexOf(a.type) - markTypes.indexOf(b.type));
  return out.length === 0 ? undefined : out;
}

const targetArbitrary = fc.oneof(
  name.map((title) => ({ title })),
  fc.record({ title: name, heading: fc.constantFrom("Part", "Plan") }),
  fc.constant({ heading: "Top" }),
  fc.constant({ block: "x1" as BlockId }),
  fc.constant({ note: "01929f4c-7b00-7a00-8000-000000000001" as never, block: "b2" as BlockId }),
);

const inlineArbitrary: fc.Arbitrary<Inline> = fc
  .tuple(
    fc.oneof(
      { weight: 5, arbitrary: word.map((text): Inline => ({ type: "text", text })) },
      { weight: 1, arbitrary: fc.constant<Inline>({ type: "hardBreak" }) },
      {
        weight: 1,
        arbitrary: fc
          .record({
            target: targetArbitrary,
            alias: fc.option(fc.constantFrom("alias", "x y"), { nil: undefined }),
          })
          .map(({ target, alias }): Inline => ({
            type: "wikiLink",
            target,
            ...(alias === undefined ? {} : { alias }),
          })),
      },
      {
        weight: 1,
        arbitrary: fc.constantFrom("tag", "a/b").map((tag): Inline => ({ type: "tag", name: tag })),
      },
      {
        weight: 1,
        arbitrary: fc.constantFrom("x^2", "a\nb").map((latex): Inline => ({ type: "math", latex })),
      },
      {
        weight: 1,
        arbitrary: fc
          .constantFrom("<kbd>", "[^1]")
          .map((markdown): Inline => ({ type: "raw", markdown })),
      },
    ),
    fc.array(markArbitrary, { maxLength: 3 }),
  )
  .map(([inline, marks]) => {
    const normalized = normalizeMarks(marks);
    return inline.type === "hardBreak" || normalized === undefined
      ? inline
      : { ...inline, marks: normalized };
  });

function sameMarks(a?: readonly Mark[], b?: readonly Mark[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** Inline content as the editor gives it back: text with the same marks merged. */
function normalizeInlines(inlines: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    const last = out[out.length - 1];
    if (inline.type === "text" && last?.type === "text" && sameMarks(last.marks, inline.marks)) {
      out[out.length - 1] = { ...last, text: last.text + inline.text };
    } else {
      out.push(inline);
    }
  }
  return out;
}

const inlines = fc.array(inlineArbitrary, { minLength: 1, maxLength: 5 }).map(normalizeInlines);
/** A toggle's summary: text only. */
const summary = fc
  .array(
    word.map((text): Inline => ({ type: "text", text })),
    { maxLength: 2 },
  )
  .map(normalizeInlines);

type Draft = Record<string, unknown> & { type: string };

const leaf: fc.Arbitrary<Draft> = fc.oneof(
  { weight: 4, arbitrary: inlines.map((content) => ({ type: "paragraph", content })) },
  {
    weight: 1,
    arbitrary: fc
      .record({
        level: fc.integer({ min: 1, max: 6 }),
        content: fc.oneof(inlines, fc.constant([])),
      })
      .map(({ level, content }) => ({ type: "heading", attrs: { level }, content })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({
        language: fc.constantFrom("", "ts", "js title=a.js"),
        text: fc.string({ maxLength: 12 }),
      })
      .map(({ language, text }) => ({ type: "code", attrs: { language }, text })),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom("x^2", "a\n= b").map((text) => ({ type: "math", text })),
  },
  { weight: 1, arbitrary: fc.constant({ type: "divider" }) },
  {
    weight: 1,
    arbitrary: fc
      .record({
        header: fc.boolean(),
        columns: fc.integer({ min: 1, max: 3 }),
        rows: fc.integer({ min: 1, max: 3 }),
        align: fc.array(fc.constantFrom("left", "center", "right", null), {
          minLength: 3,
          maxLength: 3,
        }),
        cells: fc.array(fc.oneof(inlines, fc.constant([])), { minLength: 9, maxLength: 9 }),
      })
      .map(({ header, columns, rows, align, cells }) => ({
        type: "table",
        attrs: { header, align: align.slice(0, columns) },
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
        src: fc.constantFrom("a.png", "dir/b c.jpg"),
        alt: fc.option(fc.constantFrom("A", ""), { nil: undefined }),
        title: fc.option(fc.constant("T"), { nil: undefined }),
        width: fc.option(fc.integer({ min: 1, max: 900 }), { nil: undefined }),
      })
      .map(({ src, alt, title, width }) => ({
        type: "image",
        attrs: {
          src,
          ...(alt === undefined ? {} : { alt }),
          ...(title === undefined ? {} : { title }),
          ...(width === undefined ? {} : { width }),
        },
      })),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({
        src: fc.constant("spec.pdf"),
        name: fc.option(fc.constant("Spec"), { nil: undefined }),
      })
      .map(({ src, name: fileName }) => ({
        type: "file",
        attrs: { src, ...(fileName === undefined ? {} : { name: fileName }) },
      })),
  },
  {
    weight: 1,
    arbitrary: fc.constant({ type: "bookmark", attrs: { url: "https://example.com/post" } }),
  },
  {
    weight: 1,
    arbitrary: fc
      .record({ target: targetArbitrary, alias: fc.option(fc.constant("300"), { nil: undefined }) })
      .map(({ target, alias }) => ({
        type: "embed",
        attrs: { target, ...(alias === undefined ? {} : { alias }) },
      })),
  },
  {
    weight: 1,
    arbitrary: fc.constant({
      type: "database",
      attrs: {
        database: "01929f4c-7b00-7a00-8000-000000000002",
        view: "01929f4c-7b00-7a00-8000-000000000003",
      },
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom("<div>x</div>", "[^1]: n").map((text) => ({ type: "raw", text })),
  },
  {
    weight: 1,
    arbitrary: fc.constant({
      type: "kanban/board",
      attrs: { lanes: [1, 2] },
      content: [{ type: "text", text: "x" }],
    }),
  },
);

const blockArbitrary: fc.Arbitrary<Draft> = fc.letrec<{
  block: Draft;
  blocks: Draft[];
  someBlocks: Draft[];
}>((tie) => ({
  block: fc.oneof(
    { depthSize: "small" },
    { weight: 6, arbitrary: leaf },
    {
      weight: 2,
      arbitrary: fc
        .record({
          kind: fc.constantFrom("bulletListItem", "numberedListItem", "taskListItem"),
          content: fc.oneof(inlines, fc.constant([])),
          checked: fc.boolean(),
          start: fc.option(fc.integer({ min: 2, max: 9 }), { nil: undefined }),
          children: tie("blocks"),
        })
        .map(({ kind, content, checked, start, children }) => ({
          type: kind,
          ...(kind === "taskListItem" ? { attrs: { checked } } : {}),
          ...(kind === "numberedListItem" && start !== undefined ? { attrs: { start } } : {}),
          content,
          ...(children.length === 0 ? {} : { children }),
        })),
    },
    { weight: 1, arbitrary: tie("blocks").map((children) => ({ type: "quote", children })) },
    {
      weight: 1,
      arbitrary: fc
        .record({
          kind: fc.constantFrom("note", "tip"),
          fold: fc.constantFrom(undefined, "open", "closed"),
          title: fc.oneof(inlines, fc.constant([])),
          children: tie("blocks"),
        })
        .map(({ kind, fold, title, children }) => ({
          type: "callout",
          attrs: fold === undefined ? { kind } : { kind, fold },
          content: title,
          ...(children.length === 0 ? {} : { children }),
        })),
    },
    {
      weight: 1,
      arbitrary: fc
        .record({ title: summary, children: tie("blocks") })
        .map(({ title, children }) => ({
          type: "toggle",
          content: title,
          ...(children.length === 0 ? {} : { children }),
        })),
    },
    {
      weight: 1,
      arbitrary: fc
        .array(
          fc.record({
            width: fc.option(fc.constantFrom(0.25, 0.5), { nil: undefined }),
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
  someBlocks: fc.array(tie("block"), { minLength: 1, maxLength: 3 }),
})).block;

function withIds(drafts: readonly Draft[]): ContentBlock[] {
  let next = 0;
  const visit = (draft: Draft): Draft => {
    const id = `b${String(next++)}`;
    const children = Array.isArray(draft.children)
      ? (draft.children as Draft[]).map(visit)
      : undefined;
    return { ...draft, id, ...(children === undefined ? {} : { children }) };
  };
  return drafts.map(visit) as unknown as ContentBlock[];
}

/** Blocks as the editor gives them back: a numbered item whose start would be read as continuing a list starts one. */
function representable(blocks: readonly ContentBlock[]): boolean {
  return blocks.every((block, index) => {
    if (
      block.type === "numberedListItem" &&
      block.attrs === undefined &&
      blocks[index - 1]?.type !== "numberedListItem"
    ) {
      return true;
    }
    return "children" in block && Array.isArray(block.children)
      ? representable(block.children as ContentBlock[])
      : true;
  });
}

const notes = fc
  .array(blockArbitrary, { minLength: 1, maxLength: 5 })
  .map(withIds)
  .filter((blocks) => {
    try {
      readContent(blocks, "content");
      return representable(blocks);
    } catch {
      return false;
    }
  });

describe("random notes", () => {
  it("make documents the schema accepts, and come back as the same blocks", () => {
    fc.assert(
      fc.property(notes, (blocks) => {
        const doc = toEditor(blocks);
        schema.nodeFromJSON(doc).check();
        let next = 0;
        expect(fromEditor(doc, () => `new${String(next++)}` as BlockId)).toEqual(blocks);
      }),
      { numRuns: runs },
    );
  }, 120_000);
});
