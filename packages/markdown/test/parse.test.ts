import { readContent } from "@nether/core";
import { describe, expect, it } from "vitest";
import { parseMarkdown, parseWikiLink } from "../src/index.ts";
import { blocksOf, paragraph, parse, text } from "./helpers.ts";

describe("parseWikiLink", () => {
  it.each([
    ["Note", { target: { title: "Note" } }],
    ["Note|alias", { target: { title: "Note" }, alias: "alias" }],
    ["Note\\|alias", { target: { title: "Note" }, alias: "alias" }],
    ["Note#Heading", { target: { title: "Note", heading: "Heading" } }],
    ["Note#^req-1", { target: { title: "Note", block: "req-1" } }],
    ["Note^req-1", { target: { title: "Note", block: "req-1" } }],
    ["#Heading", { target: { heading: "Heading" } }],
    ["#^req-1", { target: { block: "req-1" } }],
    ["folder/Note.md|a|b", { target: { title: "folder/Note.md" }, alias: "a|b" }],
  ])("reads %j", (text, expected) => {
    expect(parseWikiLink(text)).toEqual(expected);
  });

  it.each(["|alias", "Note|", "Note#", "#", "Note#^bad id", " "])("rejects %j", (text) => {
    expect(parseWikiLink(text)).toBeUndefined();
  });
});

describe("parseMarkdown blocks", () => {
  it("reads headings, paragraphs, dividers, code and math", () => {
    expect(
      blocksOf("# Title\n\nSome *text*.\n\n---\n\n```ts title=a.ts\nlet a;\n```\n\n$$\nx^2\n$$"),
    ).toEqual([
      { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
      paragraph(text("Some "), text("text", "italic"), text(".")),
      { type: "divider" },
      { type: "code", attrs: { language: "ts title=a.ts" }, text: "let a;" },
      { type: "math", text: "x^2" },
    ]);
  });

  it("splits lists into items, nested items into children", () => {
    expect(blocksOf("- a\n  - b\n- [x] c\n\n3. d\n4. e")).toEqual([
      {
        type: "bulletListItem",
        content: [text("a")],
        children: [{ type: "bulletListItem", content: [text("b")] }],
      },
      { type: "taskListItem", attrs: { checked: true }, content: [text("c")] },
      { type: "numberedListItem", attrs: { start: 3 }, content: [text("d")] },
      { type: "numberedListItem", content: [text("e")] },
    ]);
  });

  it("keeps an item's later paragraphs and an empty item", () => {
    expect(blocksOf("- a\n\n  b\n-\n")).toEqual([
      { type: "bulletListItem", content: [text("a")], children: [paragraph(text("b"))] },
      { type: "bulletListItem", content: [] },
    ]);
  });

  it("reads quotes, and callouts with their kind, fold, title and body", () => {
    expect(
      blocksOf(
        "> plain quote\n\n> [!WARNING]- Careful\n> body line\n>\n> - a point\n\n> [!tip]\n> only body\n\n> [!info]+",
      ),
    ).toEqual([
      { type: "quote", children: [paragraph(text("plain quote"))] },
      {
        type: "callout",
        attrs: { kind: "warning", fold: "closed" },
        content: [text("Careful")],
        children: [
          paragraph(text("body line")),
          { type: "bulletListItem", content: [text("a point")] },
        ],
      },
      {
        type: "callout",
        attrs: { kind: "tip" },
        content: [],
        children: [paragraph(text("only body"))],
      },
      { type: "callout", attrs: { kind: "info", fold: "open" }, content: [] },
    ]);
  });

  it("keeps a quote that only looks like a callout as a quote", () => {
    expect(blocksOf("> \\[!note] escaped")).toEqual([
      { type: "quote", children: [paragraph(text("[!note] escaped"))] },
    ]);
  });

  it("reads tables, filling short rows", () => {
    const [table] = parse("| a | b |\n| :- | -: |\n| 1 |").content;
    expect(table).toMatchObject({
      type: "table",
      attrs: { header: true, align: ["left", "right"] },
      children: [
        { type: "tableRow", children: [{ content: [text("a")] }, { content: [text("b")] }] },
        { type: "tableRow", children: [{ content: [text("1")] }, { content: [] }] },
      ],
    });
  });

  it("reads images with an Obsidian width, files, embeds and bookmarks", () => {
    expect(
      blocksOf(
        '![Diagram|300](a/b.png "Title")\n\n![Spec](spec.pdf)\n\n![[Note#Part|200]]\n\n<https://example.com/post>',
      ),
    ).toEqual([
      { type: "image", attrs: { src: "a/b.png", alt: "Diagram", title: "Title", width: 300 } },
      { type: "file", attrs: { src: "spec.pdf", name: "Spec" } },
      { type: "embed", attrs: { target: { title: "Note", heading: "Part" }, alias: "200" } },
      { type: "bookmark", attrs: { url: "https://example.com/post" } },
    ]);
  });

  it("keeps an image inside text, and a bare URL alone, as inline content", () => {
    expect(blocksOf("See ![x](a.png) here\n\nhttps://example.com")).toEqual(
      [
        paragraph(text("See "), { type: "raw", markdown: "![x](a.png)" }, text(" here")),
        paragraph(text("https://example.com", "link")),
      ].map((block, index) =>
        index === 1
          ? paragraph({
              type: "text",
              text: "https://example.com",
              marks: [{ type: "link", href: "https://example.com" }],
            })
          : block,
      ),
    );
  });

  it("reads columns and toggles that Nether writes between HTML markers", () => {
    expect(
      blocksOf(
        "<!-- columns -->\n<!-- column 40% -->\nleft\n<!-- column -->\nright\n<!-- /columns -->\n\n<details>\n<summary>More &amp; less</summary>\n\nhidden\n\n</details>",
      ),
    ).toEqual([
      {
        type: "columns",
        children: [
          { type: "column", attrs: { width: 0.4 }, children: [paragraph(text("left"))] },
          { type: "column", children: [paragraph(text("right"))] },
        ],
      },
      { type: "toggle", content: [text("More & less")], children: [paragraph(text("hidden"))] },
    ]);
  });

  it("keeps HTML markers that do not make columns or a toggle as raw blocks", () => {
    expect(blocksOf("<!-- columns -->\nonly one\n<!-- /columns -->")).toEqual([
      { type: "raw", text: "<!-- columns -->" },
      paragraph(text("only one")),
      { type: "raw", text: "<!-- /columns -->" },
    ]);
    expect(blocksOf("<details>\n<summary>never closed</summary>")).toEqual([
      { type: "raw", text: "<details>\n<summary>never closed</summary>" },
    ]);
  });

  it("keeps what it cannot map as raw blocks, byte for byte", () => {
    expect(
      blocksOf(
        "<div>\nhi\n</div>\n\n[ref]: https://example.com\n\n[^1]: A note.\n\n%%\nhidden\n%%",
      ),
    ).toEqual([
      { type: "raw", text: "<div>\nhi\n</div>" },
      { type: "raw", text: "[ref]: https://example.com" },
      { type: "raw", text: "[^1]: A note." },
      { type: "raw", text: "%%\nhidden\n%%" },
    ]);
  });

  it("reads a code block named like a plugin's block as that block", () => {
    expect(
      blocksOf('```kanban/board\n{"attrs":{"lanes":2}}\n```\n\n```kanban/board\nnot json\n```'),
    ).toEqual([
      { type: "kanban/board", attrs: { lanes: 2 } },
      { type: "code", attrs: { language: "kanban/board" }, text: "not json" },
    ]);
  });

  it("returns content that the core model accepts", () => {
    const parsed = parse(
      "# T ^head\n\n- [ ] a ^task\n\n> [!note] x\n> y\n\n| a |\n| - |\n| [[b\\|c]] |\n\n^table\n\n![[img.png|300]]",
    );
    expect(() => readContent(parsed.content, "content")).not.toThrow();
  });
});

describe("parseMarkdown block IDs", () => {
  it("takes ^id off the end of paragraphs, headings and list items", () => {
    const parsed = parse("Text ^p-1\n\n## Heading ^h1\n\n- item ^li\n- other");
    expect(parsed.content.map((block) => block.id)).toEqual(["p-1", "h1", "li", "b1"]);
    expect(parsed.content[0]).toMatchObject({ content: [text("Text")] });
    expect([...parsed.writtenIds]).toEqual(["p-1", "h1", "li"]);
  });

  it("gives a table or quote the ID on the line after it", () => {
    const parsed = parse("| a |\n| - |\n| 1 |\n\n^tbl\n\n> quote\n\n^q\n\nafter");
    expect(parsed.content.map((block) => [block.type, block.id])).toEqual([
      ["table", "tbl"],
      ["quote", "q"],
      ["paragraph", "b8"],
    ]);
    expect(parsed.source.blocks[0]).toMatchObject({ start: 0, idWritten: true });
    expect(
      parsed.source.text.slice(parsed.source.blocks[0]?.start, parsed.source.blocks[0]?.end),
    ).toBe("| a |\n| - |\n| 1 |\n\n^tbl");
  });

  it("keeps an escaped caret, a formatted ID and a repeated ID as text", () => {
    const parsed = parse("one \\^esc\n\ntwo *^em*\n\nthree ^same\n\nfour ^same");
    expect(parsed.content.map((block) => block.id)).toEqual(["b1", "b2", "same", "b3"]);
    expect(parsed.content[0]).toMatchObject({ content: [text("one ^esc")] });
    expect([...parsed.writtenIds]).toEqual(["same"]);
  });

  it("never makes an ID that a ^word in the file could mean", () => {
    let calls = 0;
    const parsed = parseMarkdown("^b1 is text\n\nnext", {
      newId: (taken) => {
        calls++;
        return (taken.has("b1") ? "fresh" + String(calls) : "b1") as never;
      },
    });
    expect(parsed.content.map((block) => block.id)).toEqual(["fresh1", "fresh2"]);
  });
});

describe("parseMarkdown inline content", () => {
  it("merges marks, nested and overlapping", () => {
    expect(blocksOf("***a** b* ~~c~~ ==d== <u>e</u> `f`")).toEqual([
      paragraph(
        text("a", "bold", "italic"),
        text(" b", "italic"),
        text(" "),
        text("c", "strike"),
        text(" "),
        text("d", "highlight"),
        text(" "),
        text("e", "underline"),
        text(" "),
        text("f", "code"),
      ),
    ]);
  });

  it("reads links, reference links and their titles", () => {
    expect(blocksOf('[a](https://x.com "T") [b][r] [c][missing]\n\n[r]: https://r.com')).toEqual([
      paragraph(
        { type: "text", text: "a", marks: [{ type: "link", href: "https://x.com", title: "T" }] },
        text(" "),
        { type: "text", text: "b", marks: [{ type: "link", href: "https://r.com" }] },
        text(" [c][missing]"),
      ),
      { type: "raw", text: "[r]: https://r.com" },
    ]);
  });

  it("reads wiki links, tags, math and comments, with marks around them", () => {
    expect(blocksOf("**[[Note|n]]** #tag $x$ %%c%% [[#Top]]")).toEqual([
      paragraph(
        { type: "wikiLink", target: { title: "Note" }, alias: "n", marks: [{ type: "bold" }] },
        text(" "),
        { type: "tag", name: "tag" },
        text(" "),
        { type: "math", latex: "x" },
        text(" "),
        text("c", "comment"),
        text(" "),
        { type: "wikiLink", target: { heading: "Top" } },
      ),
    ]);
  });

  it("keeps hard breaks, soft breaks, inline HTML and footnote references", () => {
    expect(blocksOf("a\\\nb\nc <kbd>K</kbd>[^1]\n\n[^1]: n")).toEqual([
      paragraph(
        text("a"),
        { type: "hardBreak" },
        text("b\nc "),
        { type: "raw", markdown: "<kbd>" },
        text("K"),
        { type: "raw", markdown: "</kbd>" },
        { type: "raw", markdown: "[^1]" },
      ),
      { type: "raw", text: "[^1]: n" },
    ]);
  });

  it("keeps what cannot be a link or a tag as raw Markdown", () => {
    expect(blocksOf("[](https://x.com) [a]() #a/ [[a|]] ``")).toEqual([
      paragraph(
        { type: "raw", markdown: "[](https://x.com)" },
        text(" "),
        { type: "raw", markdown: "[a]()" },
        text(" "),
        { type: "raw", markdown: "#a/" },
        text(" "),
        { type: "raw", markdown: "[[a|]]" },
        text(" ``"),
      ),
    ]);
  });
});

describe("parseMarkdown source", () => {
  it("remembers the line ending, the byte order mark and the file's markers", () => {
    const parsed = parse("\uFEFF* a\r\n\r\n_b_ __c__\r\n\r\n~~~\r\nx\r\n~~~\r\n\r\n***\r\n");
    expect(parsed.source).toMatchObject({
      bom: true,
      eol: "\r\n",
      style: { bullet: "*", emphasis: "_", strong: "_", fence: "~", rule: "*" },
    });
    expect(parsed.source.text.startsWith("\uFEFF")).toBe(false);
  });

  it("reads frontmatter properties, and reports YAML it cannot read", () => {
    expect(parse("---\na: 1\nb: [x, y]\n---\ntext").properties).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: ["x", "y"] },
    ]);
    const broken = parse("---\na: [1\n---\ntext");
    expect(broken.properties).toEqual([]);
    expect(broken.frontmatterError).toBeDefined();
    expect(broken.content).toEqual([expect.objectContaining({ type: "paragraph" })]);
  });
});
