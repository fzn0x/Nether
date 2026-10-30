import type { NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import { SqliteStore, migrate, schemaVersion } from "../src/index.ts";
import { nodeDatabase } from "./node-database.ts";

const note = (n: number) => `01929f4c-7b00-7a00-8000-00000000000${String(n)}` as NoteId;

describe("migrate", () => {
  it("creates the schema once and records its version", async () => {
    const database = nodeDatabase();
    await migrate(database);
    await migrate(database);
    const { rows } = await database.query("PRAGMA user_version");
    expect(rows[0]?.[0]).toBe(schemaVersion);
    const tables = await database.query("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.rows.flat()).toContain("files");
  });

  it("keeps the texts of a version 4 index, found by their rows from then on", async () => {
    const database = nodeDatabase();
    await migrate(database);
    // As version 4 left it: texts in note_texts, no table of their rows, and no detail.
    await database.execute("DROP TABLE note_text_rows");
    await database.execute("ALTER TABLE note_indexes DROP COLUMN detail");
    await database.execute("PRAGMA user_version = 4");
    await database.execute("INSERT INTO note_texts (note, title, body) VALUES (?, ?, ?)", [
      note(1),
      "Plan",
      "old words",
    ]);
    const store = await SqliteStore.open(database);
    const query = (word: string) => ({
      words: [word],
      phrases: [],
      excluded: [],
      filters: [],
      excludedFilters: [],
    });
    expect((await store.searchText(query("old"), 10)).map((hit) => hit.note)).toEqual([note(1)]);
    await store.putNoteTexts([{ note: note(1), title: "Plan", body: "new words" }]);
    expect(await store.searchText(query("old"), 10)).toEqual([]);
    expect((await store.searchText(query("new"), 10)).map((hit) => hit.note)).toEqual([note(1)]);
    await store.deleteNoteTexts([note(1)]);
    expect(await store.searchText(query("new"), 10)).toEqual([]);
    const rows = await database.query("SELECT count(*) FROM note_text_rows");
    expect(rows.rows[0]?.[0]).toBe(0);
  });

  it("keeps the index rows of a version 5 index, with no detail", async () => {
    const database = nodeDatabase();
    await migrate(database);
    // As version 5 left it: no detail column.
    await database.execute("ALTER TABLE note_indexes DROP COLUMN detail");
    await database.execute("PRAGMA user_version = 5");
    await database.execute(
      "INSERT INTO note_indexes (note, size, modified, data) VALUES (?, ?, ?, ?)",
      [note(1), 4, 40, '{"links":[]}'],
    );
    const store = await SqliteStore.open(database);
    expect(await store.noteIndexesOf([note(1)])).toEqual([
      { note: note(1), size: 4, modified: 40, data: '{"links":[]}', detail: "" },
    ]);
  });

  it("refuses an index a newer Nether wrote", async () => {
    const database = nodeDatabase();
    await database.execute(`PRAGMA user_version = ${String(schemaVersion + 1)}`);
    await expect(migrate(database)).rejects.toThrow(/newer version of Nether/);
  });
});

describe("SqliteStore", () => {
  it("keeps records across opens of the same database", async () => {
    const database = nodeDatabase();
    const store = await SqliteStore.open(database);
    await store.apply({
      upsert: [
        { path: "a.md", note: note(1), size: 3, modified: 100, hash: "abc" },
        { path: "img.png", size: 10, modified: 200 },
      ],
    });
    const again = await SqliteStore.open(database);
    expect(await again.files()).toEqual(
      expect.arrayContaining([
        { path: "a.md", note: note(1), size: 3, modified: 100, hash: "abc" },
        { path: "img.png", size: 10, modified: 200 },
      ]),
    );
  });

  it("updates a record in place and removes before it inserts, so a note can move", async () => {
    const store = await SqliteStore.open(nodeDatabase());
    await store.apply({ upsert: [{ path: "a.md", note: note(1), size: 1, modified: 1 }] });
    await store.apply({ upsert: [{ path: "a.md", note: note(1), size: 2, modified: 2 }] });
    await store.apply({
      remove: ["a.md"],
      upsert: [{ path: "moved/a.md", note: note(1), size: 2, modified: 2 }],
    });
    expect(await store.files()).toEqual([
      { path: "moved/a.md", note: note(1), size: 2, modified: 2 },
    ]);
  });

  it("applies large changes in parts", async () => {
    const store = await SqliteStore.open(nodeDatabase());
    const upsert = Array.from({ length: 4500 }, (_, index) => ({
      path: `n/${String(index)}.md`,
      size: index,
      modified: index,
    }));
    await store.apply({ upsert });
    expect(await store.files()).toHaveLength(4500);
  });

  it("leaves the index as it was when a change fails", async () => {
    const store = await SqliteStore.open(nodeDatabase());
    await store.apply({ upsert: [{ path: "a.md", note: note(1), size: 1, modified: 1 }] });
    // Two files cannot hold one note.
    await expect(
      store.apply({
        upsert: [
          { path: "b.md", size: 1, modified: 1 },
          { path: "c.md", note: note(1), size: 1, modified: 1 },
        ],
      }),
    ).rejects.toThrow();
    expect(await store.files()).toEqual([{ path: "a.md", note: note(1), size: 1, modified: 1 }]);
  });

  it("closes its database", async () => {
    const database = nodeDatabase();
    const store = await SqliteStore.open(database);
    await store.close();
    expect(() => database.raw.prepare("SELECT 1")).toThrow();
  });
});
