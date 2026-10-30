// Full-text search over notes' titles and text, in memory and in SQLite
// alike: words, a prefix while typing, phrases, exclusions, case and
// accents aside, titles first, and the text around a match.
import type { NoteId } from "@nether/core";
import { parseQuery } from "@nether/search";
import { describe, expect, it } from "vitest";
import { type IndexStore, MemoryStore, SqliteStore, matchEnd, matchStart } from "../src/index.ts";
import { nodeDatabase } from "./node-database.ts";

const id = (name: string) => name as NoteId;

const stores: [string, () => Promise<IndexStore>][] = [
  ["MemoryStore", () => Promise.resolve(new MemoryStore())],
  ["SqliteStore", () => SqliteStore.open(nodeDatabase())],
];

describe.each(stores)("%s search", (_name, open) => {
  async function filled() {
    const store = await open();
    await store.putNoteTexts([
      {
        note: id("roadmap"),
        title: "Roadmap",
        body: "The plan for the café, step by step.\nNext steps follow.",
      },
      { note: id("ideas"), title: "Ideas", body: "A roadmap of ideas, and a plan." },
      { note: id("daily"), title: "2026-10-30", body: "Worked on the old plan today." },
    ]);
    return store;
  }
  const search = async (store: IndexStore, text: string) =>
    (await store.searchText(parseQuery(text), 10)).map((hit) => hit.note);

  it("finds notes with every word, the title's match first", async () => {
    const store = await filled();
    expect(await search(store, "roadmap")).toEqual(["roadmap", "ideas"]);
    expect(await search(store, "plan step")).toEqual(["roadmap"]);
    expect(await search(store, "nothing")).toEqual([]);
    expect(await search(store, "tag:x")).toEqual([]);
  });

  it("matches the last word as typed so far, case and accents aside", async () => {
    const store = await filled();
    expect(await search(store, "ROAD")).toEqual(["roadmap", "ideas"]);
    expect(await search(store, "cafe")).toEqual(["roadmap"]);
  });

  it("finds phrases in order, and leaves out excluded words and phrases", async () => {
    const store = await filled();
    expect(await search(store, '"next steps"')).toEqual(["roadmap"]);
    expect(await search(store, '"steps next"')).toEqual([]);
    expect((await search(store, "plan -old")).sort()).toEqual(["ideas", "roadmap"]);
    expect(await search(store, 'plan -"for the"')).toEqual(expect.not.arrayContaining(["roadmap"]));
  });

  it("marks the match in the text around it", async () => {
    const store = await filled();
    const [hit] = await store.searchText(parseQuery("today"), 10);
    expect(hit?.snippet).toContain(`${matchStart}today${matchEnd}`);
  });

  it("replaces and deletes a note's text", async () => {
    const store = await filled();
    await store.putNoteTexts([{ note: id("daily"), title: "2026-10-30", body: "Rested." }]);
    expect(await search(store, "worked")).toEqual([]);
    expect(await search(store, "rested")).toEqual(["daily"]);
    await store.deleteNoteTexts([id("daily")]);
    expect(await search(store, "rested")).toEqual([]);
  });
});
