// A note's links in the desktop app: how `[[` ranks notes, the path a new
// note gets from a link, and what a link opens.
import type { NoteId } from "@nether/core";
import { LinkGraph, indexNote } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { describe, expect, it, vi } from "vitest";
import { matchScore, newNotePath, noteLinks } from "../src/noteLinks.ts";

describe("matchScore", () => {
  it("ranks a whole match, then a start, a word's start, a part, and letters in order", () => {
    expect(matchScore("roadmap", "Roadmap")).toBe(100);
    expect(matchScore("road", "Roadmap")).toBe(80);
    expect(matchScore("map", "Road map")).toBe(60);
    expect(matchScore("adm", "Roadmap")).toBe(40);
    expect(matchScore("rmp", "Roadmap")).toBe(20);
    expect(matchScore("xyz", "Roadmap")).toBe(0);
    expect(matchScore(" ", "Roadmap")).toBe(1);
  });
});

describe("newNotePath", () => {
  it("keeps folders and leaves out what file systems cannot hold", () => {
    expect(newNotePath("Next steps")).toBe("Next steps.md");
    expect(newNotePath("Projects/Plan: v2?")).toBe("Projects/Plan v2.md");
    expect(newNotePath("../a/./b.")).toBe("a/b.md");
    expect(newNotePath(" / ")).toBe("Untitled.md");
  });
});

describe("noteLinks", () => {
  async function setUp() {
    const files = {
      "Welcome.md": "Hello",
      "Projects/Roadmap.md": "---\naliases: [Plan]\n---\n# Roadmap\n\n## Next\n",
      "Archive/Roadmap.md": "Old",
      "Ideas.md": "Ideas",
    };
    const vault = new Vault(new MemoryFiles(files), new MemoryStore());
    await vault.open();
    const graph = new LinkGraph();
    for (const note of vault.notes()) {
      const parsed = parseMarkdown(files[note.path as keyof typeof files]);
      graph.set(note.id, note.path, indexNote(parsed, parsed.writtenIds));
    }
    const welcome = vault.noteAt("Welcome.md")?.id;
    if (welcome === undefined) throw new Error("The note is not in the vault.");
    const opened: NoteId[] = [];
    const links = noteLinks(
      vault,
      graph,
      welcome,
      (id) => opened.push(id),
      () => undefined,
    );
    return { vault, links, opened };
  }

  it("suggests notes by title and alias, with the path where a title finds another", async () => {
    const { links } = await setUp();
    const suggestions = links.suggest("road");
    // From the vault's top, [[Roadmap]] finds Archive/Roadmap: neither is nearer, and it sorts first.
    expect(suggestions.map((choice) => [choice.title, choice.detail, choice.target])).toEqual(
      expect.arrayContaining([
        ["Roadmap", "Projects", { title: "Projects/Roadmap" }],
        ["Roadmap", "Archive", { title: "Roadmap" }],
      ]),
    );
    const alias = links.suggest("pla")[0];
    expect(alias).toMatchObject({ title: "Plan", detail: "Roadmap", alias: "Plan" });
    expect(links.suggest("Projects/Roa")[0]?.target).toEqual({ title: "Projects/Roadmap" });
    // Not the note itself.
    expect(links.suggest("welcome")).toEqual([]);
  });

  it("suggests a note's headings after #", async () => {
    const { links } = await setUp();
    expect(links.suggest("Plan#ne").map((choice) => choice.target)).toEqual([
      { title: "Plan", heading: "Next" },
    ]);
    expect(links.suggest("Missing#x")).toEqual([]);
  });

  it("opens a note at a heading or block, and this note's own parts", async () => {
    const parts: unknown[] = [];
    const { vault } = await setUp();
    const welcome = vault.noteAt("Welcome.md")?.id;
    if (welcome === undefined) throw new Error("The note is not in the vault.");
    const graph = new LinkGraph();
    for (const note of vault.notes())
      graph.set(note.id, note.path, indexNote(parseMarkdown(""), new Set()));
    const links = noteLinks(
      vault,
      graph,
      welcome,
      (id, part) => parts.push([vault.note(id)?.path, part]),
      () => undefined,
      (tag) => parts.push(tag),
    );
    links.open({ title: "Ideas", heading: "Top" });
    links.open({ block: "b1" as never });
    links.openTag?.("start");
    expect(parts).toEqual([
      ["Ideas.md", { heading: "Top" }],
      ["Welcome.md", { block: "b1" }],
      "start",
    ]);
  });

  it("embeds a note, a heading's section, or nothing for a part it lacks", async () => {
    const { links } = await setUp();
    const whole = await links.embed?.({ title: "Plan" });
    expect(whole?.title).toBe("Roadmap");
    expect(whole?.blocks.map((block) => block.type)).toEqual(["heading", "heading"]);
    const section = await links.embed?.({ title: "Plan", heading: "Next" });
    expect(section?.blocks).toHaveLength(1);
    expect(await links.embed?.({ title: "Plan", heading: "Missing" })).toBeUndefined();
    expect(await links.embed?.({ title: "Missing" })).toBeUndefined();
  });

  it("opens the note a link names, and makes one the vault lacks", async () => {
    const { vault, links, opened } = await setUp();
    links.open({ title: "Plan" });
    links.open({ heading: "Next" });
    links.open({ title: "Fresh idea" });
    await vi.waitFor(() => {
      expect(opened).toHaveLength(3);
    });
    // A heading with no note named is this note's.
    expect(opened.map((id) => vault.note(id)?.path)).toEqual([
      "Projects/Roadmap.md",
      "Welcome.md",
      "Fresh idea.md",
    ]);
  });
});
