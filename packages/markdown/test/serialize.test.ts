import type { BlockId, ContentBlock, NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import { FrontmatterError, parseMarkdown, serializeMarkdown } from "../src/index.ts";
import { at, parse } from "./helpers.ts";

type Edit = (content: ContentBlock[]) => ContentBlock[];

/** Parses a file, changes its content, and writes it back with the parse as the source. */
function rewrite(markdown: string, edit: Edit, writeIds?: ReadonlySet<BlockId>): string {
  const parsed = parse(markdown);
  return serializeMarkdown(
    { properties: parsed.properties, content: edit([...parsed.content]) },
    { source: parsed.source, writeIds: new Set([...parsed.writtenIds, ...(writeIds ?? [])]) },
  ).text;
}

function setText(block: ContentBlock | undefined, text: string): ContentBlock {
  if (block === undefined || !("content" in block)) throw new Error("no text block");
  return { ...block, content: [{ type: "text", text }] };
}

describe("serializeMarkdown keeps what did not change", () => {
  // Odd but valid formatting that a rewrite would normalize.
  const file = [
    "Title",
    "=====",
    "",
    "Some  __strong__ text\twith a tab  ",
    "",
    "",
    "* star item",
    "*   wide item",
    "",
    "Last paragraph.",
    "",
  ].join("\n");

  it("rewrites only the block that changed", () => {
    expect(rewrite(file, (c) => c.map((b, i) => (i === 4 ? setText(b, "Changed.") : b)))).toBe(
      file.replace("Last paragraph.", "Changed."),
    );
  });

  it("writes a new block with blank lines around it and leaves the rest alone", () => {
    const added: ContentBlock = {
      id: "new" as BlockId,
      type: "paragraph",
      content: [{ type: "text", text: "Inserted." }],
    };
    expect(rewrite(file, (c) => [...c.slice(0, 2), added, ...c.slice(2)])).toBe(
      file.replace("\n\n\n* star item", "\n\nInserted.\n\n* star item"),
    );
  });

  it("keeps the bytes of blocks that moved and of blocks whose neighbour was removed", () => {
    const moved = rewrite(file, (c) => [at(c, 4), ...c.slice(0, 4)]);
    expect(moved).toBe(
      "Last paragraph.\n\nTitle\n=====\n\nSome  __strong__ text\twith a tab  \n\n\n* star item\n*   wide item\n",
    );
    expect(rewrite(file, (c) => [at(c, 0), at(c, 4)])).toBe("Title\n=====\n\nLast paragraph.\n");
  });

  it("matches blocks by content when their IDs are new, as after reading the file again", () => {
    const first = parse(file);
    const again = parseMarkdown(file);
    expect(again.content[0]?.id).not.toBe(first.content[0]?.id);
    expect(serializeMarkdown(again, { source: first.source }).text).toBe(file);
  });

  it("gives an edited list item the bullet of its list, so the list stays one", () => {
    expect(rewrite(file, (c) => c.map((b, i) => (i === 3 ? setText(b, "edited") : b)))).toBe(
      file.replace("*   wide item", "* edited"),
    );
  });

  it("numbers a new item after the one before it", () => {
    const list = "1. one\n2) two\n";
    const parsed = parse(list);
    expect(parsed.content).toHaveLength(2);
    const numbered = "7. seven\n8. eight\n\nafter\n";
    const added: ContentBlock = {
      id: "n" as BlockId,
      type: "numberedListItem",
      content: [{ type: "text", text: "nine" }],
    };
    expect(rewrite(numbered, (c) => [...c.slice(0, 2), added, ...c.slice(2)])).toBe(
      "7. seven\n8. eight\n9. nine\n\nafter\n",
    );
  });

  it("checks a task without touching the rest of the list", () => {
    const tasks = "- [ ] one\n- [ ] two\n";
    expect(
      rewrite(tasks, (c) =>
        c.map((b, i) =>
          i === 1 && b.type === "taskListItem" ? { ...b, attrs: { checked: true } } : b,
        ),
      ),
    ).toBe("- [ ] one\n- [x] two\n");
  });

  it("does not let a tight gap turn a paragraph into part of a list", () => {
    const list = "- a\n- b\n";
    const edited = rewrite(list, (c) =>
      c.map((b, i) =>
        i === 1
          ? {
              id: b.id,
              type: "paragraph",
              content: [{ type: "text", text: "b" }],
            }
          : b,
      ),
    );
    expect(edited).toBe("- a\n\nb\n");
  });

  it("drops empty paragraphs, which Markdown cannot hold", () => {
    const empty: ContentBlock = { id: "e" as BlockId, type: "paragraph", content: [] };
    expect(rewrite("a\n\nb\n", (c) => [at(c, 0), empty, at(c, 1)])).toBe("a\n\nb\n");
  });

  it("keeps a CRLF file's line endings and its byte order mark", () => {
    const crlf = "﻿# T\r\n\r\n- a\r\n- b\r\n";
    expect(rewrite(crlf, (c) => c.map((b, i) => (i === 2 ? setText(b, "c\nd") : b)))).toBe(
      "﻿# T\r\n\r\n- a\r\n- c\r\n  d\r\n",
    );
  });

  it("writes a file with nothing in it as nothing", () => {
    expect(serializeMarkdown({ properties: [], content: [] }).text).toBe("");
    expect(rewrite("", (c) => c)).toBe("");
    expect(rewrite("\n\n", (c) => c)).toBe("\n\n");
  });
});

describe("serializeMarkdown block IDs", () => {
  const file = "First.\n\n- item\n\n| a |\n| - |\n| 1 |\n";

  it("writes the ID of a block something links to, in Obsidian's place for it", () => {
    const parsed = parse(file);
    const ids = new Set(parsed.content.map((block) => block.id));
    expect(serializeMarkdown(parsed, { source: parsed.source, writeIds: ids }).text).toBe(
      `First. ^${String(parsed.content[0]?.id)}\n\n- item ^${String(parsed.content[1]?.id)}\n\n| a |\n| - |\n| 1 |\n\n^${String(parsed.content[2]?.id)}\n`,
    );
  });

  it("keeps IDs the file wrote, even when nothing asks for them", () => {
    const withIds = "Text ^keep\n\n> quote\n\n^q\n";
    const parsed = parse(withIds);
    expect(serializeMarkdown(parsed, { source: parsed.source }).text).toBe(withIds);
    const edited = parsed.content.map((block, index) =>
      index === 0 ? setText(block, "New") : block,
    );
    expect(
      serializeMarkdown({ properties: [], content: edited }, { source: parsed.source }).text,
    ).toBe("New ^keep\n\n> quote\n\n^q\n");
  });

  it("does not give a block the bytes of another block's written ID", () => {
    const parsed = parse("Same ^one\n");
    const copy: ContentBlock = { ...at(parsed.content, 0), id: "two" as BlockId };
    expect(
      serializeMarkdown({ properties: [], content: [copy] }, { source: parsed.source }).text,
    ).toBe("Same\n");
  });
});

describe("serializeMarkdown frontmatter", () => {
  const file = "---\n# comment\ntitle: Weekly\ntags: [a, b]\ndue: 2026-11-06\n---\n\nBody\n";

  function withProperties(
    markdown: string,
    change: (keys: { key: string; value: unknown }[]) => { key: string; value: unknown }[],
  ): string {
    const parsed = parse(markdown);
    return serializeMarkdown(
      { properties: change([...parsed.properties]) as never, content: parsed.content },
      { source: parsed.source },
    ).text;
  }

  it("changes only the value that changed, keeping comments, order and style", () => {
    expect(
      withProperties(file, (p) =>
        p.map((e) => (e.key === "title" ? { ...e, value: "Monthly" } : e)),
      ),
    ).toBe("---\n# comment\ntitle: Monthly\ntags: [a, b]\ndue: 2026-11-06\n---\n\nBody\n");
  });

  it("adds new keys at the end and removes deleted ones", () => {
    expect(
      withProperties(file, (p) => [
        ...p.filter((e) => e.key !== "tags"),
        { key: "done", value: false },
      ]),
    ).toBe("---\n# comment\ntitle: Weekly\ndue: 2026-11-06\ndone: false\n---\n\nBody\n");
  });

  it("quotes strings that YAML would read as another type", () => {
    expect(
      withProperties("Body\n", () => [
        { key: "a", value: "true" },
        { key: "b", value: "3" },
      ]),
    ).toBe('---\na: "true"\nb: "3"\n---\nBody\n');
  });

  it("removes the frontmatter with its last property, and adds one for a first", () => {
    expect(withProperties("---\na: 1\n---\nBody\n", () => [])).toBe("Body\n");
    expect(withProperties("Body\n", () => [{ key: "tags", value: ["x"] }])).toBe(
      "---\ntags:\n  - x\n---\nBody\n",
    );
  });

  it("keeps frontmatter it cannot read, and refuses to change its properties", () => {
    const broken = "---\na: [1\n---\nBody\n";
    expect(withProperties(broken, (p) => p)).toBe(broken);
    expect(() => withProperties(broken, () => [{ key: "a", value: 1 }])).toThrow(FrontmatterError);
  });

  it("keeps keys Nether cannot use", () => {
    expect(withProperties("---\n$x: 1\na: 1\n---\n", () => [{ key: "a", value: 2 }])).toBe(
      "---\na: 2\n$x: 1\n---\n",
    );
  });
});

describe("serializeMarkdown links", () => {
  it("writes the current title of a note a link points to by ID", () => {
    const note = "01929f4c-7b00-7a00-8000-000000000001" as NoteId;
    const content: ContentBlock[] = [
      {
        id: "p" as BlockId,
        type: "paragraph",
        content: [
          { type: "wikiLink", target: { note, heading: "Plan" }, alias: "the plan" },
          { type: "text", text: " and " },
          { type: "wikiLink", target: { note: "01929f4c-7b00-7a00-8000-000000000002" as NoteId } },
        ],
      },
    ];
    const titles = new Map([[note, "Roadmap"]]);
    expect(
      serializeMarkdown({ properties: [], content }, { noteTitle: (id) => titles.get(id) }).text,
    ).toBe("[[Roadmap#Plan|the plan]] and [[01929f4c-7b00-7a00-8000-000000000002]]\n");
  });

  it("escapes the alias pipe of a wiki link in a table cell", () => {
    const parsed = parse("| [[a\\|b]] |\n| - |\n");
    expect(serializeMarkdown(parsed).text).toBe("| [[a\\|b]] |\n| -------- |\n");
  });
});

describe("serializeMarkdown escapes text that would read as syntax", () => {
  it.each([
    "#notatag",
    "a ==b== c",
    "%%not hidden%%",
    "costs $5 or $x$",
    "ends with ^notanid",
    "[[not a link]]",
    "![[not an embed]]",
    "<u>not underlined</u>",
    "> [!note] not a callout",
  ])("%j", (value) => {
    const content: ContentBlock[] = [
      { id: "p" as BlockId, type: "paragraph", content: [{ type: "text", text: value }] },
    ];
    const text = serializeMarkdown({ properties: [], content }).text;
    expect(parseMarkdown(text).content).toEqual([
      expect.objectContaining({ type: "paragraph", content: [{ type: "text", text: value }] }),
    ]);
  });
});
