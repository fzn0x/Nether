// Web pages imported: each a note named by its title, its text as Markdown,
// what a reader does not see left behind.
import { describe, expect, it } from "vitest";
import { htmlToMarkdown, planHtml } from "../src/import/html.ts";
import { type ImportSource, parseMarkdown } from "../src/index.ts";

const page = [
  "<!doctype html><html><head><title>My  Page</title>",
  "<style>p { color: red }</style><script>var hidden = 1;</script></head>",
  "<body><h1>Heading</h1>",
  '<p>Some <b>bold</b>, <i>italic</i> and a <a href="https://example.com">link</a>.</p>',
  "<ul><li>One</li><li>Two</li></ul>",
  "<blockquote><p>Quoted</p></blockquote>",
  "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
  '<pre><code class="language-js">let a = 1;</code></pre>',
  '<img src="photo.png" alt="Photo">',
  "</body></html>",
].join("");

function source(entries: Record<string, string>): ImportSource {
  return {
    name: "pages",
    files: Object.keys(entries).map((path) => ({ path, size: entries[path]?.length ?? 0 })),
    readText: (path) => Promise.resolve(entries[path] ?? ""),
  };
}

describe("htmlToMarkdown", () => {
  it("writes a page's text as Markdown, and leaves its head, styles and scripts behind", () => {
    const { title, markdown } = htmlToMarkdown(page);
    expect(title).toBe("My Page");
    expect(markdown).toBe(
      [
        "# Heading",
        "",
        "Some **bold**, *italic* and a [link](https://example.com).",
        "",
        "- One",
        "- Two",
        "",
        "> Quoted",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "```js",
        "let a = 1;",
        "```",
        "",
        "![Photo](photo.png)",
        "",
      ].join("\n"),
    );
    expect(markdown).not.toContain("hidden");
    expect(markdown).not.toContain("color");
  });

  it("takes the first heading for a title when the page has none", () => {
    expect(htmlToMarkdown("<h1>Only a heading</h1><p>Text</p>").title).toBe("Only a heading");
    expect(htmlToMarkdown("<p>Text</p>").title).toBeUndefined();
  });
});

describe("planHtml", () => {
  it("makes each page a note named by its title, keeping a title a file cannot hold", async () => {
    const plan = await planHtml(
      source({
        "a.html": page,
        "b.htm": "<title>Q3: plan</title><p>Text</p>",
        "c.html": "<p>No title</p>",
        "d.html": "<title>My Page</title><p>Again</p>",
        "notes.txt": "not a page",
      }),
      "Imported",
    );
    expect(plan.notes.map((note) => note.path)).toEqual([
      "Imported/My Page.md",
      "Imported/Q3 plan.md",
      "Imported/c.md",
      "Imported/My Page 2.md",
    ]);
    expect(parseMarkdown(plan.notes[1]?.text ?? "").properties).toEqual([
      { key: "aliases", value: ["Q3: plan"] },
    ]);
    expect(plan.notes[2]?.text).toBe("No title\n");
  });
});
