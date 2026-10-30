import type { BlockId, LinkTarget } from "@nether/core";
import { describe, expect, it } from "vitest";
import {
  blocksToHtml,
  escapeHtml,
  headingSlug,
  noteArticle,
  noteToHtml,
  parseMarkdown,
  propertiesToHtml,
} from "../src/index.ts";

function ids() {
  let count = 0;
  return { newId: () => `b${String(++count)}` as BlockId };
}

/** A note's Markdown as HTML, without hooks unless given. */
async function html(markdown: string, hooks = {}): Promise<string> {
  const parsed = parseMarkdown(markdown, ids());
  return blocksToHtml(parsed.content, hooks, parsed.writtenIds);
}

describe("blocksToHtml", () => {
  it("writes text with its marks, and leaves comments out", async () => {
    expect(
      await html("A **bold** _it_ ~~gone~~ `code` ==mark== %%hidden%% <tag> & [x](https://a.test)"),
    ).toBe(
      '<p>A <strong>bold</strong> <em>it</em> <s>gone</s> <code>code</code> <mark>mark</mark>  &lt;tag&gt; &amp; <a href="https://a.test">x</a></p>',
    );
  });

  it("follows only addresses a page can follow safely, or as the hook says", async () => {
    expect(await html("[a](javascript:alert(1)) [b](notes/b.md) [c](mailto:c@d.test)")).toBe(
      '<p>a <a href="notes/b.md">b</a> <a href="mailto:c@d.test">c</a></p>',
    );
    expect(
      await html("[b](notes/b.md)", { href: (href: string) => href.replace(/\.md$/, ".html") }),
    ).toBe('<p><a href="notes/b.html">b</a></p>');
  });

  it("links notes where the hook says, and shows the rest as text", async () => {
    const link = (target: LinkTarget) =>
      "title" in target && target.title === "Plan" ? "Plan.html" : undefined;
    expect(await html("[[Plan]], [[Plan|the plan]], [[Gone#Part]] and #tag/sub", { link })).toBe(
      '<p><a class="internal-link" href="Plan.html">Plan</a>, <a class="internal-link" href="Plan.html">the plan</a>, <span class="internal-link unresolved">Gone &gt; Part</span> and <span class="tag">#tag/sub</span></p>',
    );
  });

  it("gives headings anchors, numbered when their text repeats, and written IDs to blocks", async () => {
    expect(await html("# Plan & Scope\n\n## Plan & scope\n\nText ^abc\n")).toBe(
      '<h1 id="plan-scope">Plan &amp; Scope</h1>\n<h2 id="plan-scope-1">Plan &amp; scope</h2>\n<p id="^abc">Text</p>',
    );
  });

  it("gathers list items into lists, tasks with their boxes, nested ones inside", async () => {
    expect(await html("- a\n  - b\n- c\n\n3. three\n4. four\n\n- [x] done\n- [ ] todo\n")).toBe(
      [
        "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>",
        '<ol start="3"><li>three</li><li>four</li></ol>',
        '<ul class="tasks"><li class="task"><input type="checkbox" disabled checked> done</li><li class="task"><input type="checkbox" disabled> todo</li></ul>',
      ].join("\n"),
    );
  });

  it("keeps lists of different kinds apart", async () => {
    expect(await html("- [ ] task\n- plain\n1. one\n")).toBe(
      [
        '<ul class="tasks"><li class="task"><input type="checkbox" disabled> task</li></ul>',
        "<ul><li>plain</li></ul>",
        "<ol><li>one</li></ol>",
      ].join("\n"),
    );
  });

  it("writes quotes, callouts, folded callouts and dividers", async () => {
    expect(
      await html("> quoted\n\n> [!tip] Try it\n> body\n\n> [!warning]-\n> hidden\n\n---\n"),
    ).toBe(
      [
        "<blockquote><p>quoted</p></blockquote>",
        '<aside class="callout" data-callout="tip"><p class="callout-title">Try it</p><p>body</p></aside>',
        '<details class="callout" data-callout="warning"><summary class="callout-title">Warning</summary><p>hidden</p></details>',
        "<hr>",
      ].join("\n"),
    );
  });

  it("writes tables with their header and alignment", async () => {
    expect(await html("| a | b |\n| :- | -: |\n| 1 | 2 |\n")).toBe(
      '<table><thead><tr><th style="text-align: left">a</th><th style="text-align: right">b</th></tr></thead><tbody><tr><td style="text-align: left">1</td><td style="text-align: right">2</td></tr></tbody></table>',
    );
  });

  it("writes code and math as text, or as the hooks render them", async () => {
    const markdown = "```ts\nlet a = 1 < 2;\n```\n\n$$\nx^2\n$$\n\nInline $y$.\n";
    expect(await html(markdown)).toBe(
      [
        '<pre><code class="language-ts">let a = 1 &lt; 2;</code></pre>',
        '<pre class="math">x^2</pre>',
        '<p>Inline <code class="math">y</code>.</p>',
      ].join("\n"),
    );
    const hooks = {
      code: (text: string, language: string) => `[${language}:${text}]`,
      math: (latex: string, display: boolean) =>
        `<math display="${display ? "block" : "inline"}">${latex}</math>`,
    };
    expect(await html(markdown, hooks)).toBe(
      [
        '<pre><code class="language-ts">[ts:let a = 1 < 2;]</code></pre>',
        '<div class="math"><math display="block">x^2</math></div>',
        '<p>Inline <span class="math"><math display="inline">y</math></span>.</p>',
      ].join("\n"),
    );
  });

  it("draws diagrams with the hook, or shows their code", async () => {
    const markdown = "```mermaid\ngraph LR\n  a --> b\n```\n";
    expect(await html(markdown)).toBe(
      '<pre><code class="language-mermaid">graph LR\n  a --&gt; b</code></pre>',
    );
    expect(await html(markdown, { diagram: () => Promise.resolve("<svg></svg>") })).toBe(
      '<figure class="diagram"><svg></svg></figure>',
    );
  });

  it("shows files by their kind where the hook finds them, and their names where it does not", async () => {
    const file = (src: string) => (src.includes("gone") ? undefined : `files/${src}`);
    expect(
      await html(
        "![[photo.png|300]]\n\n![[clip.mp4]]\n\n![[talk.mp3]]\n\n![[paper.pdf|The paper]]\n\n![[gone.png]]\n\n![alt](https://a.test/x.png)\n",
        { file },
      ),
    ).toBe(
      [
        '<p class="image"><img src="files/photo.png" alt="" width="300"></p>',
        '<p class="file"><video controls src="files/clip.mp4"></video></p>',
        '<p class="file"><audio controls src="files/talk.mp3"></audio></p>',
        '<p class="file"><a href="files/paper.pdf">The paper</a></p>',
        '<p class="file missing">gone.png</p>',
        '<p class="image"><img src="files/https://a.test/x.png" alt="alt"></p>',
      ].join("\n"),
    );
    expect(await html("![alt](https://a.test/x.png)\n")).toBe(
      '<p class="image"><img src="https://a.test/x.png" alt="alt"></p>',
    );
  });

  it("shows an embedded note as the hook renders it, or a link to it", async () => {
    expect(await html("![[Plan#Goals]]\n", { embed: () => "<p>goals</p>" })).toBe(
      '<div class="embed"><p>goals</p></div>',
    );
    expect(await html("![[Plan#Goals]]\n", { link: () => "Plan.html#goals" })).toBe(
      '<p class="embed"><a class="internal-link" href="Plan.html#goals">Plan &gt; Goals</a></p>',
    );
    expect(await html("![[Plan]]\n")).toBe('<p class="embed unresolved">Plan</p>');
  });

  it("writes bookmarks, toggles and what Nether keeps as written", async () => {
    expect(await html("<https://a.test/page>\n\n<div>raw</div>\n")).toBe(
      '<p class="bookmark"><a href="https://a.test/page">https://a.test/page</a></p>\n<pre class="raw">&lt;div&gt;raw&lt;/div&gt;</pre>',
    );
    expect(
      await blocksToHtml([
        {
          id: "t" as BlockId,
          type: "toggle",
          content: [{ type: "text", text: "More" }],
          children: [
            { id: "p" as BlockId, type: "paragraph", content: [{ type: "text", text: "x" }] },
          ],
        },
        {
          id: "c" as BlockId,
          type: "columns",
          children: [
            { id: "c1" as BlockId, type: "column", attrs: { width: 0.5 }, children: [] },
            { id: "c2" as BlockId, type: "column", children: [] },
          ],
        },
      ]),
    ).toBe(
      '<details><summary>More</summary><p>x</p></details>\n<div class="columns"><div class="column" style="flex: 0.5"></div><div class="column"></div></div>',
    );
  });
});

describe("noteToHtml", () => {
  it("makes a page with the note's title, properties and blocks", async () => {
    const parsed = parseMarkdown("---\ntags: [a, b]\ndue: 2026-11-06\n---\nHello\n", ids());
    expect(
      await noteToHtml({ title: "Plan <1>", ...parsed }, {}, { lang: "fr", style: "p{}" }),
    ).toBe(
      [
        "<!doctype html>",
        '<html lang="fr">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>Plan &lt;1&gt;</title>",
        "<style>p{}</style>",
        "</head>",
        "<body>",
        "<article>",
        '<h1 class="title">Plan &lt;1&gt;</h1>',
        '<dl class="properties"><dt>tags</dt><dd>a, b</dd><dt>due</dt><dd>2026-11-06</dd></dl><p>Hello</p>',
        "</article>",
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    );
  });

  it("gives the page's article alone for a page made elsewhere", async () => {
    const parsed = parseMarkdown("Hello\n", ids());
    expect(await noteArticle({ title: "Plan", ...parsed })).toBe(
      '<h1 class="title">Plan</h1>\n<p>Hello</p>',
    );
  });

  it("leaves out the title when the note starts with its own heading", async () => {
    const parsed = parseMarkdown("# Plan\n", ids());
    const page = await noteToHtml({ title: "Plan", ...parsed });
    expect(page).not.toContain('class="title"');
    expect(page).toContain('<h1 id="plan">Plan</h1>');
  });
});

describe("helpers", () => {
  it("escapes text for HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("makes anchors of headings", () => {
    expect(headingSlug(" Next Steps! ")).toBe("next-steps");
    expect(headingSlug("Café au lait")).toBe("café-au-lait");
    expect(headingSlug("???")).toBe("section");
  });

  it("writes nothing for no properties, and lists and objects as text", () => {
    expect(propertiesToHtml([])).toBe("");
    expect(
      propertiesToHtml([
        { key: "a", value: null },
        { key: "b", value: { x: 1 } },
      ]),
    ).toBe('<dl class="properties"><dt>a</dt><dd></dd><dt>b</dt><dd>{&quot;x&quot;:1}</dd></dl>');
  });
});
