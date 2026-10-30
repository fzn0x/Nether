// Renaming and moving a note, with every link to it rewritten.
import { LinkGraph, indexNote } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";
import { MemoryFiles, Vault } from "@nether/storage";
import { MemoryStore } from "@nether/storage";
import { describe, expect, it } from "vitest";
import { folderMoves, moveFiles, pageMoves, renameNote, renamedPath } from "../src/renameNote.ts";

async function setUp(files: Record<string, string>) {
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, new MemoryStore());
  await vault.open();
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

describe("renameNote", () => {
  it("renames a note, and rewrites every link to it, keeping headings, blocks and aliases", async () => {
    const { vault, graph, id, text } = await setUp({
      "Plan.md": "# Plan\n\nSee [[Plan#Goals]].\n",
      "Daily.md":
        '---\nup: "[[Plan]]"\n---\n[[Plan]], [[Plan#Goals|goals]], ![[Plan^abc]], [[Other]], `[[Plan]]`\n',
      "Other.md": "Nothing here.\n",
    });
    const plan = id("Plan.md");
    const moved = await renameNote(vault, graph, plan, "Roadmap.md");
    expect(moved).toMatchObject({ id: plan, path: "Roadmap.md", title: "Roadmap" });
    expect(await text("Daily.md")).toBe(
      '---\nup: "[[Roadmap]]"\n---\n[[Roadmap]], [[Roadmap#Goals|goals]], ![[Roadmap^abc]], [[Other]], `[[Plan]]`\n',
    );
    // Its own links to itself too.
    expect(await text("Roadmap.md")).toBe("# Plan\n\nSee [[Roadmap#Goals]].\n");
    expect(await text("Other.md")).toBe("Nothing here.\n");
  });

  it("writes a path where another note has the name, or where the link wrote one", async () => {
    const { vault, graph, id, text } = await setUp({
      "Projects/Plan.md": "Plan\n",
      "Archive/Roadmap.md": "Old roadmap\n",
      "Index.md": "[[Plan]] and [[Projects/Plan|by path]]\n",
    });
    await renameNote(vault, graph, id("Projects/Plan.md"), "Projects/Roadmap.md");
    expect(await text("Index.md")).toBe("[[Projects/Roadmap]] and [[Projects/Roadmap|by path]]\n");
  });

  it("moves a note to another folder, leading Markdown links to it and from it", async () => {
    const { vault, graph, id, text } = await setUp({
      "Notes/Plan.md":
        "![photo](../attachments/My%20photo.png) [ideas](Ideas.md) [web](https://a.test)\n",
      "Notes/Ideas.md": "[the plan](Plan.md) and [[Plan]]\n",
      "attachments/My photo.png": "png",
    });
    await renameNote(vault, graph, id("Notes/Plan.md"), "Archive/2026/Plan.md");
    expect(await text("Notes/Ideas.md")).toBe("[the plan](../Archive/2026/Plan.md) and [[Plan]]\n");
    expect(await text("Archive/2026/Plan.md")).toBe(
      "![photo](../../attachments/My%20photo.png) [ideas](../../Notes/Ideas.md) [web](https://a.test)\n",
    );
  });

  it("keeps spaces in an address written in angle brackets", async () => {
    const { vault, graph, id, text } = await setUp({
      "Plan.md": "Plan\n",
      "Index.md": "[plan](<Plan.md>)\n",
    });
    await renameNote(vault, graph, id("Plan.md"), "Big Plan.md");
    expect(await text("Index.md")).toBe("[plan](<Big Plan.md>)\n");
  });

  it("refuses a path another note has, and changes nothing", async () => {
    const { vault, graph, id, text } = await setUp({
      "Plan.md": "Plan\n",
      "Roadmap.md": "Roadmap\n",
      "Index.md": "[[Plan]]\n",
    });
    await expect(renameNote(vault, graph, id("Plan.md"), "Roadmap.md")).rejects.toThrow(
      /already at Roadmap\.md/,
    );
    expect(await text("Index.md")).toBe("[[Plan]]\n");
    expect(await renameNote(vault, graph, id("Plan.md"), "Plan.md")).toMatchObject({
      path: "Plan.md",
    });
  });
});

describe("moveFiles", () => {
  it("moves a page with the folder of its pages, and every link follows", async () => {
    const { vault, graph, id, text } = await setUp({
      "Projects.md": "# Projects\n\n[[Projects/Plan]] and [[Ideas]]\n",
      "Projects/Plan.md":
        "![[sketch.png]] ![s](sketch.png) [up](../Projects.md) [home](../Home.md)\n",
      "Projects/Ideas.md": "[[Plan]]\n",
      "Projects/sketch.png": "png",
      "Home.md": "[[Projects]], [[Plan]], [p](Projects/Plan.md)\n",
    });
    const plan = id("Projects/Plan.md");
    await moveFiles(vault, graph, pageMoves(vault, "Projects.md", "Archive/Projects.md"));
    expect(vault.files()).toEqual([
      "Archive/Projects.md",
      "Archive/Projects/Ideas.md",
      "Archive/Projects/Plan.md",
      "Archive/Projects/sketch.png",
      "Home.md",
    ]);
    expect(vault.noteAt("Archive/Projects/Plan.md")?.id).toBe(plan);
    expect(await text("Archive/Projects.md")).toBe(
      "# Projects\n\n[[Archive/Projects/Plan]] and [[Ideas]]\n",
    );
    // Links between the moved files hold; those leading out are led from the new folder.
    expect(await text("Archive/Projects/Plan.md")).toBe(
      "![[sketch.png]] ![s](sketch.png) [up](../Projects.md) [home](../../Home.md)\n",
    );
    expect(await text("Archive/Projects/Ideas.md")).toBe("[[Plan]]\n");
    expect(await text("Home.md")).toBe("[[Projects]], [[Plan]], [p](Archive/Projects/Plan.md)\n");
  });

  it("moves a folder, writing a path for a file whose name another has", async () => {
    const { vault, graph, text } = await setUp({
      "a/x.png": "png",
      "b/x.png": "png",
      "a/Note.md": "![[a/x.png]]\n",
      "Index.md": "[[Note]] ![[a/x.png]]\n",
    });
    await moveFiles(vault, graph, folderMoves(vault, "a", "c/a"));
    expect(vault.files()).toEqual(["b/x.png", "c/a/Note.md", "c/a/x.png", "Index.md"]);
    expect(await text("c/a/Note.md")).toBe("![[c/a/x.png]]\n");
    expect(await text("Index.md")).toBe("[[Note]] ![[c/a/x.png]]\n");
  });

  it("refuses a move onto a file that stays, and moves nothing", async () => {
    const { vault, graph } = await setUp({ "a/n.md": "N", "b/n.md": "B" });
    await expect(moveFiles(vault, graph, folderMoves(vault, "a", "b"))).rejects.toThrow(
      /already at b\/n\.md/,
    );
    expect(vault.files()).toEqual(["a/n.md", "b/n.md"]);
  });
});

describe("renamedPath", () => {
  it("gives the path a new name takes in the note's folder", () => {
    expect(renamedPath("Projects/Plan.md", " Roadmap ")).toEqual({ path: "Projects/Roadmap.md" });
    expect(renamedPath("Plan.md", "Roadmap.md")).toEqual({ path: "Roadmap.md" });
  });

  it("says why a name cannot be a note's", () => {
    expect(renamedPath("Plan.md", " ")).toEqual({ error: "empty" });
    for (const name of ["a/b", "a:b", "[[x]]", "a#b", ".hidden", "a|b"]) {
      expect(renamedPath("Plan.md", name)).toEqual({ error: "unsafe" });
    }
  });
});
