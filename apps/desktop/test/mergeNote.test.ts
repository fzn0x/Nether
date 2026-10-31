// Merging a note into another: its text after the other's, its properties
// joined, every link to it led to the other, and it in the trash.
import { LinkGraph, indexNote } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeNote, mergedProperties } from "../src/mergeNote.ts";

const watching: AbortController[] = [];

afterEach(() => {
  for (const controller of watching.splice(0)) controller.abort();
});

async function setUp(files: Record<string, string>) {
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, new MemoryStore());
  await vault.open();
  const controller = new AbortController();
  watching.push(controller);
  void vault.watch(controller.signal);
  const graph = new LinkGraph();
  for (const note of vault.notes()) {
    const parsed = parseMarkdown(files[note.path] ?? "");
    graph.set(note.id, note.path, indexNote(parsed, parsed.writtenIds));
  }
  const id = (path: string) => {
    const note = vault.noteAt(path);
    if (note === undefined) throw new Error(`No note at ${path}.`);
    return note.id;
  };
  const text = async (path: string) => (await memory.read(path)).text;
  return { vault, graph, id, text };
}

describe("mergedProperties", () => {
  it("keeps the other's, adds those it has not, and joins lists both have", () => {
    expect(
      mergedProperties(
        [
          { key: "status", value: "draft" },
          { key: "tags", value: ["work"] },
        ],
        [
          { key: "status", value: "done" },
          { key: "Tags", value: ["work", "home"] },
          { key: "due", value: "2026-11-01" },
          { key: "database", value: { views: [] } },
        ],
      ),
    ).toEqual([
      { key: "status", value: "draft" },
      { key: "tags", value: ["work", "home"] },
      { key: "due", value: "2026-11-01" },
    ]);
    // A property that only shares the name of a database's schema is kept.
    expect(mergedProperties([], [{ key: "database", value: "Postgres" }])).toEqual([
      { key: "database", value: "Postgres" },
    ]);
  });
});

describe("mergeNote", () => {
  it("puts its text after the other's, leads every link to the other, and trashes it", async () => {
    const { vault, graph, id, text } = await setUp({
      "Plan.md": "---\ntags: [work]\n---\n\n# Plan\n\nThe plan. [[Ideas#Later]]\n",
      "Projects/Ideas.md":
        "---\ntags: [home]\nowner: Ada\n---\n\n# Later\n\nAn idea ^abc\n\nSee [the image](pics/a.png) and [[Plan]].\n",
      "Projects/pics/a.png": "png",
      "Daily.md": "[[Ideas]], [[Ideas#Later|later]], ![[Ideas^abc]], [ideas](Projects/Ideas.md)\n",
    });
    const ideas = id("Projects/Ideas.md");
    await mergeNote(vault, graph, ideas, id("Plan.md"));

    // Links elsewhere lead to Plan, keeping the heading and block, whose text came along.
    expect(await text("Daily.md")).toBe(
      "[[Plan]], [[Plan#Later|later]], ![[Plan^abc]], [ideas](Plan.md)\n",
    );
    await vi.waitFor(async () => {
      expect(await text("Plan.md")).toBe(
        "---\ntags: [work, home]\nowner: Ada\n---\n\n# Plan\n\nThe plan. [[Plan#Later]]\n\n# Later\n\nAn idea ^abc\n\nSee [the image](Projects/pics/a.png) and [[Plan]].\n",
      );
    });
    expect(vault.note(ideas)).toBeUndefined();
    expect((await vault.trash()).map((item) => item.from)).toEqual(["Projects/Ideas.md"]);
  });

  it("will not merge a note into itself", async () => {
    const { vault, graph, id } = await setUp({ "Plan.md": "# Plan\n" });
    await expect(mergeNote(vault, graph, id("Plan.md"), id("Plan.md"))).rejects.toThrow(
      "A note cannot be merged into itself.",
    );
  });
});
