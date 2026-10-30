// Searching a vault: the index's matches filtered by tag, path and
// property, the quick switcher's matches, and a snippet's marked parts.
import { LinkGraph, indexNote, plainText } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";
import { parseQuery } from "@nether/search";
import { MemoryFiles, MemoryStore, Vault, matchEnd, matchStart } from "@nether/storage";
import { describe, expect, it } from "vitest";
import { searchVault, snippetParts, switcherMatches } from "../src/search.ts";

async function setUp() {
  const files: Record<string, string> = {
    "Welcome.md": "---\ntags: [start]\n---\nHello and welcome.",
    "Projects/Roadmap.md":
      "---\naliases: [Plan]\nstatus: [active, big]\npriority: 2\n---\nThe plan. #project",
    "Projects/Ideas.md": "Ideas for the plan. #project/nether",
  };
  const store = new MemoryStore();
  const vault = new Vault(new MemoryFiles(files), store);
  await vault.open();
  const graph = new LinkGraph();
  for (const note of vault.notes()) {
    const parsed = parseMarkdown(files[note.path] ?? "");
    graph.set(note.id, note.path, indexNote(parsed, parsed.writtenIds));
    await store.putNoteTexts([
      { note: note.id, title: note.title, body: plainText(parsed.content) },
    ]);
  }
  const titles = async (text: string) =>
    (await searchVault(vault, graph, parseQuery(text))).map((result) => result.note.title);
  return { vault, graph, titles };
}

describe("searchVault", () => {
  it("finds notes by words, then filters them", async () => {
    const { titles } = await setUp();
    expect((await titles("plan")).sort()).toEqual(["Ideas", "Roadmap"]);
    expect(await titles("plan tag:project/nether")).toEqual(["Ideas"]);
    expect(await titles("plan -tag:project/nether")).toEqual(["Roadmap"]);
  });

  it("filters every note by tag, path and property when no words are given", async () => {
    const { titles } = await setUp();
    expect(await titles("tag:project")).toEqual(["Ideas", "Roadmap"]);
    expect(await titles("path:projects/r")).toEqual(["Roadmap"]);
    expect(await titles("prop:status=active")).toEqual(["Roadmap"]);
    expect(await titles("prop:priority=2")).toEqual(["Roadmap"]);
    expect(await titles("prop:priority=3")).toEqual([]);
    expect(await titles("[aliases]")).toEqual(["Roadmap"]);
    expect(await titles("prop:missing")).toEqual([]);
  });
});

describe("switcherMatches", () => {
  it("matches titles, aliases and paths, the best first", async () => {
    const { vault, graph } = await setUp();
    expect(switcherMatches(vault, graph, "idea").map((match) => match.note.title)).toEqual([
      "Ideas",
    ]);
    const alias = switcherMatches(vault, graph, "plan")[0];
    expect(alias).toMatchObject({ alias: "Plan" });
    expect(alias?.note.title).toBe("Roadmap");
    expect(switcherMatches(vault, graph, "projects/ro").map((match) => match.note.title)).toEqual([
      "Roadmap",
    ]);
    expect(switcherMatches(vault, graph, "")).toHaveLength(3);
  });
});

describe("snippetParts", () => {
  it("splits a snippet into its text and its marked matches", () => {
    expect(snippetParts(`a ${matchStart}b${matchEnd} c ${matchStart}d${matchEnd}`)).toEqual([
      { text: "a ", match: false },
      { text: "b", match: true },
      { text: " c ", match: false },
      { text: "d", match: true },
    ]);
  });
});
