// A note's unlinked mentions: the notes the index finds with its name or an
// alias, where they write it without a link, and a mention made a link.
import { LinkGraph, indexNote, plainText } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { describe, expect, it } from "vitest";
import { linkMentionIn, unlinkedMentions } from "../src/mentions.ts";

async function setUp() {
  const files: Record<string, string> = {
    "Projects/Roadmap.md": "---\naliases: [Plan]\n---\nThe Roadmap itself.\n",
    "Archive/Roadmap.md": "An old one.\n",
    "Welcome.md": "See the roadmap, and [[Projects/Roadmap|the Roadmap]].\n",
    "Ideas.md": "# Ideas\n\nA plan for the plan.\n",
    "Other.md": "Nothing here, no ideas.\n",
  };
  const memory = new MemoryFiles(files);
  const store = new MemoryStore();
  const vault = new Vault(memory, store);
  await vault.open();
  const graph = new LinkGraph();
  for (const note of vault.notes()) {
    const parsed = parseMarkdown(files[note.path] ?? "");
    graph.set(note.id, note.path, indexNote(parsed, parsed.writtenIds));
    await store.putNoteTexts([
      { note: note.id, title: note.title, body: plainText(parsed.content) },
    ]);
  }
  const idOf = (path: string) => {
    const id = vault.noteAt(path)?.id;
    if (id === undefined) throw new Error(`${path} is not in the vault.`);
    return id;
  };
  return { memory, vault, graph, idOf };
}

describe("unlinkedMentions", () => {
  it("finds the notes that write a note's name or an alias without linking it", async () => {
    const { vault, graph, idOf } = await setUp();
    const found = await unlinkedMentions(vault, graph, idOf("Projects/Roadmap.md"));
    // The other Roadmap mentions none of its names; the note's own text is left out.
    expect(
      found.map(({ note, mentions }) => [note.path, mentions.map((mention) => mention.text)]),
    ).toEqual([
      ["Ideas.md", ["plan", "plan"]],
      ["Welcome.md", ["roadmap"]],
    ]);
  });

  it("finds none for a note no other note names", async () => {
    const { vault, graph, idOf } = await setUp();
    expect(await unlinkedMentions(vault, graph, idOf("Welcome.md"))).toEqual([]);
  });
});

describe("linkMentionIn", () => {
  it("links a mention by the note's path where its name finds another note", async () => {
    const { memory, vault, graph, idOf } = await setUp();
    const roadmap = idOf("Projects/Roadmap.md");
    const [ideas] = await unlinkedMentions(vault, graph, roadmap);
    const second = ideas?.mentions[1];
    if (ideas === undefined || second === undefined) throw new Error("no mention");
    await linkMentionIn(vault, graph, roadmap, ideas.note.id, second);
    expect((await memory.read("Ideas.md")).text).toBe(
      "# Ideas\n\nA plan for the [[Projects/Roadmap|plan]].\n",
    );
  });

  it("links it by name where the name finds the note, after another app changed the file", async () => {
    const { memory, vault, graph, idOf } = await setUp();
    const ideas = idOf("Ideas.md");
    const [other] = await unlinkedMentions(vault, graph, ideas);
    const [mention] = other?.mentions ?? [];
    if (other === undefined || mention === undefined) throw new Error("no mention");
    // The file changes after the mention was found: it is found again on its line.
    memory.edit("Other.md", "First.\nNothing here, no ideas.\n");
    await linkMentionIn(vault, graph, ideas, other.note.id, mention);
    expect((await memory.read("Other.md")).text).toBe(
      "First.\nNothing here, no [[Ideas|ideas]].\n",
    );
  });

  it("says when the mention is no longer there", async () => {
    const { memory, vault, graph, idOf } = await setUp();
    const roadmap = idOf("Projects/Roadmap.md");
    const [ideas] = await unlinkedMentions(vault, graph, roadmap);
    const [mention] = ideas?.mentions ?? [];
    if (ideas === undefined || mention === undefined) throw new Error("no mention");
    memory.edit("Ideas.md", "# Ideas\n\nNothing now.\n");
    await expect(linkMentionIn(vault, graph, roadmap, ideas.note.id, mention)).rejects.toThrow(
      "Ideas no longer has the mention.",
    );
  });
});
