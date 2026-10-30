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
