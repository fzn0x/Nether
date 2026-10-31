// Unlinked mentions: a name written as text, found where it is written, and
// made a link with every other byte of the file kept.
import { describe, expect, it } from "vitest";
import { findMentions, linkMention } from "../src/index.ts";

const texts = (markdown: string, names: readonly string[]) =>
  findMentions(markdown, names).map((mention) => mention.text);

describe("findMentions", () => {
  it("finds a name as a whole word, case aside, with its line and column", () => {
    const markdown = "# Notes\n\nThe roadmap is set.\nRoadmaps and myroadmap are not it.\n";
    const [mention, ...rest] = findMentions(markdown, ["Roadmap"]);
    expect(rest).toEqual([]);
    expect(mention).toEqual({
      start: markdown.indexOf("roadmap"),
      end: markdown.indexOf("roadmap") + 7,
      text: "roadmap",
      line: "The roadmap is set.",
      column: 4,
      inTable: false,
    });
  });

  it("leaves out links, tags, code, math, comments, HTML, block IDs and the frontmatter", () => {
    const markdown = [
      "---",
      "about: Roadmap",
      "---",
      "[[Roadmap]] and [[Other|Roadmap]] and ![[Roadmap]]",
      "[Roadmap](https://example.com) and #Roadmap and `Roadmap`",
      "$Roadmap$ and %%Roadmap%% and Projects/Roadmap",
      "",
      "<div>Roadmap</div>",
      "",
      "```",
      "Roadmap",
      "```",
      "",
      "A line ^roadmap",
      "",
      "Only this Roadmap.",
      "",
    ].join("\n");
    expect(findMentions(markdown, ["Roadmap"]).map((mention) => mention.line)).toEqual([
      "Only this Roadmap.",
    ]);
  });

  it("finds every name, the longest where names overlap, in emphasis, lists and headings", () => {
    const markdown = "## Road map\n\n- the **Plan** and the road map, then Road\n";
    expect(texts(markdown, ["Road map", "Plan", "Road", " "])).toEqual([
      "Road map",
      "Plan",
      "road map",
      "Road",
    ]);
  });

  it("finds a name in a table's cell, and names in any script", () => {
    const markdown = "| Plan | Ποτάμι |\n| --- | --- |\n| plan | ποτάμι |\n";
    const mentions = findMentions(markdown, ["Plan", "Ποτάμι"]);
    expect(mentions.map((mention) => [mention.text, mention.inTable])).toEqual([
      ["Plan", true],
      ["Ποτάμι", true],
      ["plan", true],
      ["ποτάμι", true],
    ]);
  });

  it("finds nothing without a name", () => {
    expect(findMentions("Anything", [])).toEqual([]);
    expect(findMentions("Anything", ["", "  "])).toEqual([]);
  });
});

describe("linkMention", () => {
  it("links a mention as it is written, keeping every other byte", () => {
    const markdown = "*Intro*\r\n\r\nSee roadmap  and Roadmap.\r\n";
    const [lower, exact] = findMentions(markdown, ["Roadmap"]);
    if (lower === undefined || exact === undefined) throw new Error("no mentions");
    expect(linkMention(markdown, lower, "Roadmap")).toBe(
      "*Intro*\r\n\r\nSee [[Roadmap|roadmap]]  and Roadmap.\r\n",
    );
    expect(linkMention(markdown, exact, "Roadmap")).toBe(
      "*Intro*\r\n\r\nSee roadmap  and [[Roadmap]].\r\n",
    );
    // The link names the note by its path where its name finds another.
    expect(linkMention(markdown, exact, "Projects/Roadmap")).toBe(
      "*Intro*\r\n\r\nSee roadmap  and [[Projects/Roadmap|Roadmap]].\r\n",
    );
  });

  it("escapes the link's bar in a table's cell", () => {
    const markdown = "| a |\n| --- |\n| plan |\n";
    const [mention] = findMentions(markdown, ["Plan"]);
    if (mention === undefined) throw new Error("no mention");
    expect(linkMention(markdown, mention, "Plan")).toBe("| a |\n| --- |\n| [[Plan\\|plan]] |\n");
  });
});
