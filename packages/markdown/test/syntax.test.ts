import type { Node, Parent } from "mdast";
import { describe, expect, it } from "vitest";
import { markdownToTree } from "../src/index.ts";

/** The nodes of a Markdown text, as `type` or `type:value`, depth first. */
function nodes(markdown: string): string[] {
  const out: string[] = [];
  const visit = (node: Node): void => {
    if (node.type !== "root" && node.type !== "paragraph") {
      const value = "value" in node ? `:${String(node.value)}` : "";
      const embed =
        node.type === "wikiLink" && (node as unknown as { embed: boolean }).embed ? "!" : "";
      out.push(`${embed}${node.type}${value}`);
    }
    if ("children" in node) for (const child of (node as Parent).children) visit(child);
  };
  visit(markdownToTree(markdown));
  return out;
}

describe("wiki links and embeds", () => {
  it.each([
    ["[[Note]]", ["wikiLink:Note"]],
    ["[[Note|alias]]", ["wikiLink:Note|alias"]],
    ["[[Note#Heading]]", ["wikiLink:Note#Heading"]],
    ["![[image.png|300]]", ["!wikiLink:image.png|300"]],
    ["a [[B]] c", ["text:a ", "wikiLink:B", "text: c"]],
  ])("reads %s", (markdown, expected) => {
    expect(nodes(markdown)).toEqual(expected);
  });

  it.each([
    ["[[]]", "nothing between the brackets"],
    ["[[a\nb]]", "a line break"],
    ["[[a[b]]", "a bracket inside"],
    ["[[a]", "a missing bracket"],
    ["\\[[a]]", "an escaped bracket"],
    ["`[[a]]`", "code"],
  ])("leaves %j as it is: %s", (markdown) => {
    expect(nodes(markdown).some((node) => node.includes("wikiLink"))).toBe(false);
  });

  it("does not take an image for an embed", () => {
    expect(nodes("![alt](a.png)")).toEqual(["image"]);
  });
});

describe("tags", () => {
  it.each([
    ["#project", ["tag:project"]],
    ["a #area/research b", ["text:a ", "tag:area/research", "text: b"]],
    ["#tag.", ["tag:tag", "text:."]],
    ["#déjà-vu", ["tag:déjà-vu"]],
    ["## Heading #tag", ["heading", "text:Heading ", "tag:tag"]],
  ])("reads %s", (markdown, expected) => {
    expect(nodes(markdown)).toEqual(expected);
  });

  it.each([
    ["a#b", "after a letter"],
    ["#2026", "only digits"],
    ["# Heading", "a heading"],
    ["\\#tag", "escaped"],
    ["[x](#anchor)", "a link destination"],
    ["https://example.com/#anchor", "a URL"],
    ["#", "a hash alone"],
  ])("leaves %j as it is: %s", (markdown) => {
    expect(nodes(markdown).some((node) => node.startsWith("tag"))).toBe(false);
  });
});

describe("highlights", () => {
  it("reads ==text== and the formatting inside it", () => {
    expect(nodes("a ==b **c**== d")).toEqual([
      "text:a ",
      "highlight",
      "text:b ",
      "strong",
      "text:c",
      "text: d",
    ]);
  });

  it("keeps the line breaks inside a highlight", () => {
    expect(nodes("==a\nb==")).toEqual(["highlight", "text:a\nb"]);
  });

  it.each(["a = b", "=a=", "===a===", "a== b ==c", "\\==a=="])("leaves %j as it is", (markdown) => {
    expect(nodes(markdown).includes("highlight")).toBe(false);
  });
});

describe("comments", () => {
  it.each([
    ["%%hidden%%", ["obsidianComment:hidden"]],
    ["a %%b % c%% d", ["text:a ", "obsidianComment:b % c", "text: d"]],
    ["%%a\nb%%", ["obsidianComment:a\nb"]],
  ])("reads %j inline", (markdown, expected) => {
    expect(nodes(markdown)).toEqual(expected);
  });

  it("leaves an unclosed or empty marker as it is", () => {
    expect(nodes("50%% off")).toEqual(["text:50%% off"]);
    expect(nodes("%%a%%%")).toEqual(["text:%%a%%%"]);
  });

  it("reads a comment over several lines as a block, blank lines and all", () => {
    expect(nodes("%%\nfirst\n\nsecond\n%%\n\nafter")).toEqual([
      "commentBlock:%%\nfirst\n\nsecond\n%%",
      "text:after",
    ]);
  });

  it("runs an unclosed comment block to the end, as an unclosed fence does", () => {
    expect(nodes("%%\nnever closed\n\nstill a comment")).toEqual([
      "commentBlock:%%\nnever closed\n\nstill a comment",
    ]);
  });

  it("reads a comment block inside a quote", () => {
    expect(nodes("> %%\n> hidden\n> %%")).toEqual(["blockquote", "commentBlock:%%\nhidden\n%%"]);
  });

  it("closes a comment block at the next %%, wherever it stands on its line", () => {
    expect(nodes("%%\nhidden\n\nend%% shown\n\nafter")).toEqual([
      "commentBlock:%%\nhidden\n\nend%% shown",
      "text:after",
    ]);
  });

  it("reads %% with text after it as an inline comment, so it never hides what follows", () => {
    expect(nodes("%% note to self\nmore\n%%\n\nafter")).toEqual([
      "obsidianComment: note to self\nmore\n",
      "text:after",
    ]);
    expect(nodes("%%a\nb%% c\n\nafter")).toEqual(["obsidianComment:a\nb", "text: c", "text:after"]);
  });
});

describe("math", () => {
  it.each([
    ["$x$", ["inlineMath:x"]],
    ["a $e^{i\\pi}$ b", ["text:a ", "inlineMath:e^{i\\pi}", "text: b"]],
    ["$a \\$ b$", ["inlineMath:a \\$ b"]],
    ["$a\nb$", ["inlineMath:a\nb"]],
    ["$$x$$", ["rawInline:$$x$$"]],
  ])("reads %j inline", (markdown, expected) => {
    expect(nodes(markdown)).toEqual(expected);
  });

  it.each([
    ["A price of $5 and $10", "spaces before the closing dollar"],
    ["$ x$", "a space after the opening dollar"],
    ["$x $", "a space before the closing dollar"],
    ["$x$5", "a digit after the closing dollar"],
    ["\\$x$", "an escaped dollar"],
    ["$", "a dollar alone"],
    ["$$ x", "an unclosed pair"],
  ])("leaves %j as text: %s", (markdown) => {
    expect(nodes(markdown).some((node) => node.startsWith("inlineMath"))).toBe(false);
  });

  it("reads display math between lines of $$", () => {
    expect(nodes("$$\n\\frac{1}{2}\n$$")).toEqual(["math:\\frac{1}{2}"]);
  });
});
