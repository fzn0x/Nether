// The link index: what it reads from a note, which note a link names,
// backlinks with their context, and tags across the vault.
import type { NoteId } from "@nether/core";
import { parseMarkdown } from "@nether/markdown";
import { describe, expect, it } from "vitest";
import { LinkGraph, indexNote, noteSection, plainText } from "../src/index.ts";

function index(markdown: string) {
  const parsed = parseMarkdown(markdown);
  return indexNote(parsed, parsed.writtenIds);
}

const id = (name: string) => name as NoteId;

describe("indexNote", () => {
  it("reads links, embeds, tags, aliases, headings and written block IDs", () => {
    const note = index(
      [
        "---",
        "aliases: [Plan, The plan]",
        "tags: [project, '#area/work']",
        "---",
        "# Roadmap",
        "",
        "See [[Ideas]] and [[Projects/Done#Wins|the wins]], #urgent and #Project. ^intro",
        "",
        "## Next",
        "",
        "![[Diagram]]",
        "",
        "- [Old notes](Archive/Old%20notes.md) and [[#Next]]",
        "- [[Ideas]] again, and [the web](https://example.com/a.md)",
        "",
        "```",
        "[[Not a link]] #not-a-tag",
        "```",
      ].join("\n"),
    );
    expect(note.links).toEqual([
      expect.objectContaining({ target: "Ideas", embed: false }),
      expect.objectContaining({ target: "Projects/Done", heading: "Wins", embed: false }),
      expect.objectContaining({ target: "Diagram", embed: true, context: "" }),
      expect.objectContaining({ target: "Archive/Old notes.md", embed: false }),
      expect.objectContaining({ target: "", heading: "Next" }),
      expect.objectContaining({ target: "Ideas", context: "Ideas again, and the web" }),
    ]);
    expect(note.links[0]?.context).toBe("See Ideas and the wins, #urgent and #Project.");
    expect(note.tags).toEqual(["urgent", "Project", "area/work"]);
    expect(note.aliases).toEqual(["Plan", "The plan"]);
    expect(note.headings).toEqual([
      { level: 1, text: "Roadmap" },
      { level: 2, text: "Next" },
    ]);
    expect(note.blocks).toEqual(["intro"]);
  });

  it("reads a single alias or tag written as text", () => {
    const note = index("---\nalias: Only one\ntags: a, b\n---\nText\n");
    expect(note.aliases).toEqual(["Only one"]);
    expect(note.tags).toEqual(["a", "b"]);
  });
});

describe("LinkGraph", () => {
  function vault() {
    const graph = new LinkGraph();
    graph.set(
      id("roadmap"),
      "Projects/Roadmap.md",
      index("---\naliases: [Plan]\n---\n# Roadmap\n#project/nether\n"),
    );
    graph.set(
      id("ideas"),
      "Ideas.md",
      index("Links to [[Roadmap]] and [[Plan#Next]]. #project\n\nAnd [[Missing]].\n"),
    );
    graph.set(
      id("daily"),
      "Daily/2026-10-30.md",
      index("Worked on [[Projects/Roadmap]].\n\n![[Roadmap]]\n"),
    );
    graph.set(id("self"), "Self.md", index("[[Self]] and [[#Heading]]\n"));
    return graph;
  }

  it("finds the note a link names, by path or by alias, case aside", () => {
    const graph = vault();
    expect(graph.resolve("Roadmap", "Ideas.md")).toBe("roadmap");
    expect(graph.resolve("projects/roadmap", "Ideas.md")).toBe("roadmap");
    expect(graph.resolve("Projects/Roadmap.md", "Ideas.md")).toBe("roadmap");
    expect(graph.resolve("plan", "Ideas.md")).toBe("roadmap");
    expect(graph.resolve("Missing", "Ideas.md")).toBeUndefined();
    expect(graph.resolve(" ", "Ideas.md")).toBeUndefined();
  });

  it("lists the notes that link to a note, with each link and its context", () => {
    const graph = vault();
    const backlinks = graph.backlinks(id("roadmap"));
    expect(backlinks.map((backlink) => backlink.source)).toEqual(["daily", "ideas"]);
    expect(backlinks[0]?.links.map((link) => link.embed)).toEqual([false, true]);
    expect(backlinks[1]?.links.map((link) => link.context)).toEqual([
      "Links to Roadmap and Plan#Next. #project",
      "Links to Roadmap and Plan#Next. #project",
    ]);
    // A note's links to itself are not backlinks.
    expect(graph.backlinks(id("self"))).toEqual([]);
  });

  it("follows notes as they change, move and leave", () => {
    const graph = vault();
    let changes = 0;
    const stop = graph.subscribe(() => changes++);
    graph.set(id("roadmap"), "Archive/Roadmap.md", index("# Roadmap\n"));
    expect(graph.resolve("Roadmap", "Ideas.md")).toBe("roadmap");
    // Its alias went with the edit.
    expect(graph.resolve("Plan", "Ideas.md")).toBeUndefined();
    graph.remove(id("ideas"));
    graph.remove(id("ideas"));
    expect(graph.backlinks(id("roadmap")).map((backlink) => backlink.source)).toEqual(["daily"]);
    expect(graph.note(id("ideas"))).toBeUndefined();
    expect([...graph.notes()]).toHaveLength(3);
    stop();
    graph.remove(id("daily"));
    expect(changes).toBe(2);
  });

  it("counts tags with the tags under them, and lists the notes with one", () => {
    const graph = vault();
    expect(graph.tags()).toEqual([
      { tag: "project", count: 2 },
      { tag: "project/nether", count: 1 },
    ]);
    expect(graph.notesWithTag("#Project")).toEqual(["ideas", "roadmap"]);
    expect(graph.notesWithTag("project/nether")).toEqual(["roadmap"]);
  });
});

describe("noteSection", () => {
  const blocks = parseMarkdown(
    "# Plan\n\nIntro.\n\n## Next  steps\n\nFirst. ^first\n\n### Detail\n\nMore.\n\n## Later\n\nAfter.\n\n- item ^nested\n",
  ).content;
  const texts = (part: Parameters<typeof noteSection>[1]) =>
    noteSection(blocks, part)?.map((block) => block.type);

  it("gives a heading's section, up to the next heading as high or higher", () => {
    expect(texts({ heading: "next steps" })).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
    ]);
    expect(texts({ heading: "Later" })).toEqual(["heading", "paragraph", "bulletListItem"]);
    expect(texts({ heading: "Plan" })).toHaveLength(blocks.length);
    expect(texts({ heading: "Missing" })).toBeUndefined();
  });

  it("gives one block by its ID, nested too, or the whole note", () => {
    expect(texts({ block: "first" })).toEqual(["paragraph"]);
    expect(texts({ block: "nested" })).toEqual(["bulletListItem"]);
    expect(texts({ block: "missing" })).toBeUndefined();
    expect(noteSection(blocks, {})).toBe(blocks);
  });
});

describe("indexNote, the less common parts", () => {
  it("gives a link's context with breaks, math and raw HTML as they read", () => {
    // A backslash at a line's end is a hard break; an embed inside text stays as written.
    const note = index("Line one\\\nline two $x^2$ <kbd>K</kbd> [[Target]] ![[Img.png]]\n");
    expect(note.links[0]?.context).toBe("Line one line two x^2 <kbd>K</kbd> Target ![[Img.png]]");
  });

  it("leaves out properties of the wrong type", () => {
    const note = index("---\naliases: 3\ntags: { a: 1 }\n---\nText\n");
    expect(note.aliases).toEqual([]);
    expect(note.tags).toEqual([]);
  });
});

describe("LinkGraph, unchanged parts", () => {
  it("keeps what it worked out when a note changes but its path and aliases do not", () => {
    const graph = new LinkGraph();
    graph.set(id("a"), "A.md", index("---\naliases: [Alpha]\n---\n[[B]]\n"));
    graph.set(id("b"), "B.md", index("B\n"));
    expect(graph.resolve("alpha", "B.md")).toBe("a");
    graph.set(id("a"), "A.md", index("---\naliases: [Alpha]\n---\n[[B]] again\n"));
    expect(graph.resolve("Alpha", "B.md")).toBe("a");
    expect(graph.backlinks(id("b")).map((backlink) => backlink.source)).toEqual(["a"]);
    expect(graph.tags()).toEqual([]);
  });
});

describe("plainText", () => {
  it("gives every block's words on lines of their own, code and math too", () => {
    const parsed = parseMarkdown(
      "# Title\n\nSome **bold** [[Link|text]] and #tag.\n\n- item\n    - nested\n\n```ts\nconst x = 1;\n```\n\n$$\ne=mc^2\n$$\n\n| a | b |\n| - | - |\n| c | d |\n",
    );
    expect(plainText(parsed.content).split("\n")).toEqual([
      "Title",
      "Some bold text and #tag.",
      "item",
      "nested",
      "const x = 1;",
      "e=mc^2",
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("keeps a note's properties in its index, for searches by property", () => {
    expect(index("---\nstatus: done\n---\nText\n").properties).toEqual([
      { key: "status", value: "done" },
    ]);
  });
});
