import { describe, expect, it } from "vitest";
import { type WrittenLink, findLinks, relinkMarkdown } from "../src/index.ts";

/** Each link as its kind, target and whether it embeds, and the text its range covers. */
function links(markdown: string) {
  return findLinks(markdown).map((link: WrittenLink) => ({
    kind: link.kind,
    target: link.target,
    embed: link.embed,
    written: markdown.slice(link.start, link.end),
  }));
}

describe("findLinks", () => {
  it("finds wiki links and embeds, the note each names apart from its heading, block and alias", () => {
    expect(
      links("[[Plan]] [[Plan#Goals]] [[Plan#^abc]] [[Plan^abc]] ![[Plan|alias]] [[#Local]]\n"),
    ).toEqual([
      { kind: "wiki", target: "Plan", embed: false, written: "Plan" },
      { kind: "wiki", target: "Plan", embed: false, written: "Plan" },
      { kind: "wiki", target: "Plan", embed: false, written: "Plan" },
      { kind: "wiki", target: "Plan", embed: false, written: "Plan" },
      { kind: "wiki", target: "Plan", embed: true, written: "Plan" },
    ]);
  });

  it("finds links in tables, with their escaped aliases", () => {
    expect(links("| a |\n| - |\n| [[Projects/Plan\\|the plan]] |\n")).toEqual([
      { kind: "wiki", target: "Projects/Plan", embed: false, written: "Projects/Plan" },
    ]);
  });

  it("leaves out what code and math write", () => {
    expect(
      links("`[[Code]]`\n\n```\n[[Fenced]]\n```\n\n$[[Math]]$\n\n$$\n[[Display]]\n$$\n"),
    ).toEqual([]);
  });

  it("finds wiki links in the frontmatter", () => {
    expect(links('---\nup: "[[Plan]]"\nrelated: ["[[A#x]]", "[[B]]"]\n---\nText\n')).toEqual([
      { kind: "wiki", target: "Plan", embed: false, written: "Plan" },
      { kind: "wiki", target: "A", embed: false, written: "A" },
      { kind: "wiki", target: "B", embed: false, written: "B" },
    ]);
  });

  it("finds Markdown links and images to paths, and not to the web or anchors", () => {
    expect(
      links(
        '[a](Plan.md) ![b](../attachments/My%20photo.png "title") [c](<Some Note.md>) [d](https://a.test/x.md) [e](#part) [f](mailto:a@b.test)\n',
      ),
    ).toEqual([
      { kind: "markdown", target: "Plan.md", embed: false, written: "Plan.md" },
      {
        kind: "markdown",
        target: "../attachments/My%20photo.png",
        embed: true,
        written: "../attachments/My%20photo.png",
      },
      { kind: "markdown", target: "Some Note.md", embed: false, written: "Some Note.md" },
    ]);
  });

  it("counts a byte order mark in where links are", () => {
    const markdown = "﻿[[Plan]]";
    const [link] = findLinks(markdown);
    expect(markdown.slice(link?.start, link?.end)).toBe("Plan");
  });
});

describe("relinkMarkdown", () => {
  it("rewrites what links name, keeping headings, blocks, aliases and every other byte", () => {
    const markdown =
      '---\nup: "[[Plan]]"\n---\n# Notes\r\n\r\nSee [[Plan#Goals|goals]], ![[Plan]] and [[Other]].\r\n\r\n| [[Plan\\|p]] |\r\n| - |\r\n\r\n`[[Plan]]` and [the plan](Plan.md).\r\n';
    expect(
      relinkMarkdown(markdown, (link) =>
        link.target === "Plan"
          ? "Archive/Plan"
          : link.target === "Plan.md"
            ? "Archive/Plan.md"
            : undefined,
      ),
    ).toBe(
      '---\nup: "[[Archive/Plan]]"\n---\n# Notes\r\n\r\nSee [[Archive/Plan#Goals|goals]], ![[Archive/Plan]] and [[Other]].\r\n\r\n| [[Archive/Plan\\|p]] |\r\n| - |\r\n\r\n`[[Plan]]` and [the plan](Archive/Plan.md).\r\n',
    );
  });

  it("gives the Markdown back as it was when no link changes", () => {
    const markdown = "[[Plan]] and [x](Plan.md)";
    expect(relinkMarkdown(markdown, () => undefined)).toBe(markdown);
    expect(relinkMarkdown(markdown, (link) => link.target)).toBe(markdown);
  });
});
