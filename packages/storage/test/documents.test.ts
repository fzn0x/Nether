// A note's document in the index: its Yjs updates kept in order, compacted
// into a snapshot, and the hash of the file it matches, in memory and in
// SQLite alike.
import type { NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import { type IndexStore, MemoryStore, SqliteStore } from "../src/index.ts";
import { nodeDatabase } from "./node-database.ts";

const note = "01929f4c-7b00-7a00-8000-000000000001" as NoteId;
const other = "01929f4c-7b00-7a00-8000-000000000002" as NoteId;
const bytes = (...values: number[]) => new Uint8Array(values);

const stores: [string, () => Promise<IndexStore>][] = [
  ["MemoryStore", () => Promise.resolve(new MemoryStore())],
  ["SqliteStore", () => SqliteStore.open(nodeDatabase())],
];

describe.each(stores)("%s documents", (_name, open) => {
  it("has no updates and no file for a note never opened", async () => {
    const store = await open();
    expect(await store.document(note)).toEqual({ updates: [] });
  });

  it("keeps a note's updates in order, apart from other notes'", async () => {
    const store = await open();
    await store.appendUpdates(note, [bytes(1), bytes(2)]);
    await store.appendUpdates(other, [bytes(9)]);
    await store.appendUpdates(note, [bytes(3)]);
    await store.appendUpdates(note, []);
    const { updates } = await store.document(note);
    expect(updates.map((update) => update.seq)).toEqual([1, 2, 3]);
    expect(updates.map((update) => [...update.data])).toEqual([[1], [2], [3]]);
    expect((await store.document(other)).updates.map((update) => [...update.data])).toEqual([[9]]);
  });

  it("compacts the updates up to one into a snapshot, keeping later ones after it", async () => {
    const store = await open();
    await store.appendUpdates(note, [bytes(1), bytes(2), bytes(3)]);
    await store.compact(note, bytes(1, 2), 2);
    let { updates } = await store.document(note);
    expect(updates.map((update) => [update.seq, [...update.data]])).toEqual([
      [2, [1, 2]],
      [3, [3]],
    ]);
    // New updates still come after the last.
    await store.appendUpdates(note, [bytes(4)]);
    ({ updates } = await store.document(note));
    expect(updates.map((update) => update.seq)).toEqual([2, 3, 4]);
  });

  it("records the hash of the file the document matches", async () => {
    const store = await open();
    await store.setFileHash(note, "abc");
    await store.setFileHash(note, "def");
    expect(await store.document(note)).toEqual({ updates: [], fileHash: "def" });
  });

  it("forgets a note's document and nothing of another's", async () => {
    const store = await open();
    await store.appendUpdates(note, [bytes(1)]);
    await store.setFileHash(note, "abc");
    await store.appendUpdates(other, [bytes(9)]);
    await store.deleteDocument(note);
    expect(await store.document(note)).toEqual({ updates: [] });
    expect((await store.document(other)).updates).toHaveLength(1);
    // A note never kept is forgotten all the same.
    await store.deleteDocument(note);
    await store.appendUpdates(note, [bytes(2)]);
    expect((await store.document(note)).updates.map((update) => update.seq)).toEqual([1]);
  });
});

describe("SqliteStore documents", () => {
  it("keeps them across opens of the same database", async () => {
    const database = nodeDatabase();
    const first = await SqliteStore.open(database);
    await first.appendUpdates(note, [bytes(7, 8)]);
    await first.setFileHash(note, "hash");
    const again = await SqliteStore.open(database);
    const stored = await again.document(note);
    expect(stored.fileHash).toBe("hash");
    expect(stored.updates.map((update) => [...update.data])).toEqual([[7, 8]]);
  });
});

describe.each(stores)("%s note indexes", (_name, open) => {
  it("keeps, replaces and deletes notes' index rows", async () => {
    const store = await open();
    expect(await store.noteIndexes()).toEqual([]);
    await store.putNoteIndexes([
      { note, size: 1, modified: 10, data: "{}" },
      { note: other, size: 2, modified: 20, data: '{"tags":["a"]}' },
    ]);
    await store.putNoteIndexes([{ note, size: 3, modified: 30, data: '{"links":[]}' }]);
    const rows = await store.noteIndexes();
    expect([...rows].sort((a, b) => a.size - b.size)).toEqual([
      { note: other, size: 2, modified: 20, data: '{"tags":["a"]}' },
      { note, size: 3, modified: 30, data: '{"links":[]}' },
    ]);
    await store.deleteNoteIndexes([note]);
    expect((await store.noteIndexes()).map((row) => row.note)).toEqual([other]);
  });

  it("gives rows a part at a time in the order of their notes, and the rows of some notes", async () => {
    const store = await open();
    const ids = Array.from(
      { length: 5 },
      (_, n) => `01929f4c-7b00-7a00-8000-00000000010${String(n)}` as NoteId,
    );
    // Put out of order, and one more after the order was read.
    await store.putNoteIndexes(
      [3, 0, 4, 1].map((n) => ({ note: ids[n] ?? note, size: n, modified: n, data: "{}" })),
    );
    const notes = async (after: string, limit: number) =>
      (await store.noteIndexPage(after, limit)).map((row) => row.size);
    expect(await notes("", 2)).toEqual([0, 1]);
    await store.putNoteIndexes([{ note: ids[2] ?? note, size: 2, modified: 2, data: "{}" }]);
    expect(await notes(ids[1] ?? "", 2)).toEqual([2, 3]);
    expect(await notes(ids[3] ?? "", 2)).toEqual([4]);
    expect(await notes(ids[4] ?? "", 2)).toEqual([]);
    await store.deleteNoteIndexes([ids[2] ?? note]);
    expect(await notes(ids[1] ?? "", 2)).toEqual([3, 4]);
    expect(
      (await store.noteIndexesOf([ids[4] ?? note, ids[2] ?? note, ids[0] ?? note]))
        .map((row) => row.size)
        .sort(),
    ).toEqual([0, 4]);
  });
});
