// The vault's trash: where removed notes go, what is recorded of them, and
// how they come back or are deleted for good.
import type { NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import {
  MemoryFiles,
  MemoryStore,
  Vault,
  commentsDocument,
  numberedPath,
  readTrashRecord,
} from "../src/index.ts";

const day = 86_400_000;

function ids(): () => NoteId {
  let next = 0;
  return () => `01929f4c-7b00-7a00-8000-${String(++next).padStart(12, "0")}` as NoteId;
}

async function setup(files: Record<string, string>) {
  const clock = { now: 1_000 * day };
  const memory = new MemoryFiles(files);
  const store = new MemoryStore();
  const vault = new Vault(memory, store, { newId: ids(), now: () => clock.now });
  await vault.open();
  const id = (path: string) => {
    const note = vault.noteAt(path);
    if (note === undefined) throw new Error(`No note at ${path}.`);
    return note.id;
  };
  return { clock, memory, store, vault, id };
}

describe("Vault trash", () => {
  it("records where each removed note was, and lists the latest first", async () => {
    const { clock, vault, id } = await setup({ "a.md": "A", "x/a.md": "XA" });
    const a = id("a.md");
    const xa = id("x/a.md");
    expect(await vault.remove(a)).toBe(".trash/a.md");
    clock.now += 1;
    expect(await vault.remove(xa)).toBe(".trash/a 2.md");
    expect(await vault.trash()).toEqual([
      { path: ".trash/a 2.md", from: "x/a.md", deleted: 1_000 * day + 1, note: xa },
      { path: ".trash/a.md", from: "a.md", deleted: 1_000 * day, note: a },
    ]);
    expect(vault.notes()).toEqual([]);
  });

  it("restores a note where it was, as the same note with its document", async () => {
    const { store, vault, id } = await setup({ "Projects/Plan.md": "Plan" });
    const plan = id("Projects/Plan.md");
    await store.appendUpdates(plan, [new Uint8Array([1])]);
    const where = await vault.remove(plan);
    expect(await vault.restore(where)).toBe("Projects/Plan.md");
    expect(vault.noteAt("Projects/Plan.md")?.id).toBe(plan);
    expect((await store.document(plan)).updates).toHaveLength(1);
    expect(await vault.trash()).toEqual([]);
    expect((await vault.read(plan)).text).toBe("Plan");
  });

  it("restores beside a note now where it was, under a free name", async () => {
    const { vault, id } = await setup({ "Plan.md": "old", "Plan 2.md": "two" });
    const where = await vault.remove(id("Plan.md"));
    await vault.create("Plan.md", "new");
    expect(await vault.restore(where)).toBe("Plan 3.md");
    expect((await vault.read(id("Plan 3.md"))).text).toBe("old");
  });

  it("records a file another app put in the trash as gone when found, and restores it as a new note", async () => {
    const { clock, vault } = await setup({
      "a.md": "A",
      ".trash/Old.md": "old",
      ".trash/folder/Deep.md": "deep",
    });
    expect(await vault.trash()).toEqual([
      { path: ".trash/Old.md", from: "Old.md", deleted: 1_000 * day },
      { path: ".trash/folder/Deep.md", from: "folder/Deep.md", deleted: 1_000 * day },
    ]);
    // Found once: its time does not move.
    clock.now += day;
    expect((await vault.trash()).map((item) => item.deleted)).toEqual([1_000 * day, 1_000 * day]);
    expect(await vault.restore(".trash/folder/Deep.md")).toBe("folder/Deep.md");
    expect(vault.noteAt("folder/Deep.md")?.id).toBeDefined();
  });

  it("forgets what another app took out of the trash", async () => {
    const { memory, vault, id } = await setup({ "a.md": "A" });
    const where = await vault.remove(id("a.md"));
    await memory.erase(where);
    expect(await vault.trash()).toEqual([]);
    await expect(vault.restore(where)).rejects.toThrow(/not in the trash/);
  });

  it("deletes a note for good, with its document and its comments", async () => {
    const { memory, store, vault, id } = await setup({ "a.md": "A", "b.md": "B" });
    const a = id("a.md");
    await store.appendUpdates(a, [new Uint8Array([1])]);
    await store.appendUpdates(commentsDocument(a), [new Uint8Array([2])]);
    const where = await vault.remove(a);
    await vault.erase(where);
    expect(await memory.read(where)).toMatchObject({ missing: true });
    expect(await store.document(a)).toEqual({ updates: [] });
    expect(await store.document(commentsDocument(a))).toEqual({ updates: [] });
    expect(await vault.trash()).toEqual([]);
    await expect(vault.erase(where)).rejects.toThrow(/not in the trash/);
    expect(vault.notes().map((note) => note.path)).toEqual(["b.md"]);
  });

  it("empties the trash, or what went there before a time", async () => {
    const { clock, vault, id } = await setup({ "a.md": "A", "b.md": "B", "c.md": "C" });
    await vault.remove(id("a.md"));
    clock.now += day;
    await vault.remove(id("b.md"));
    clock.now += day;
    await vault.remove(id("c.md"));
    expect(await vault.emptyTrash(1_000 * day + day)).toBe(1);
    expect((await vault.trash()).map((item) => item.from)).toEqual(["c.md", "b.md"]);
    expect(await vault.emptyTrash()).toBe(2);
    expect(await vault.trash()).toEqual([]);
  });

  it("deletes for good what has been in the trash longer than the vault keeps it", async () => {
    const { clock, vault, id } = await setup({ "a.md": "A", "b.md": "B" });
    expect(await vault.trashDays()).toBe(30);
    await vault.remove(id("a.md"));
    clock.now += 10 * day;
    await vault.remove(id("b.md"));
    clock.now += 21 * day;
    // a.md has been there 31 days, b.md 21.
    expect(await vault.purgeTrash()).toBe(1);
    await vault.setTrashDays(7);
    expect(await vault.trashDays()).toBe(7);
    expect(await vault.purgeTrash()).toBe(1);
    expect(await vault.trash()).toEqual([]);
    await expect(vault.setTrashDays(0)).rejects.toThrow(/not a number of days/);
    await expect(vault.setTrashDays(1.5)).rejects.toThrow(/not a number of days/);
  });
});

describe("readTrashRecord", () => {
  it("keeps what it can use of the record and leaves out the rest", () => {
    expect(readTrashRecord(undefined)).toEqual({ keepDays: 30, items: [] });
    expect(
      readTrashRecord({
        keepDays: 0,
        items: [
          { path: ".trash/a.md", from: "a.md", deleted: 5, note: "n1" },
          { path: ".trash/b.md", from: "b.md", deleted: 6, note: 7 },
          { path: "outside.md", from: "a.md", deleted: 5 },
          { path: ".trash/c.md", from: "", deleted: 5 },
          { path: ".trash/d.md", from: "d.md", deleted: "yesterday" },
          null,
        ],
      }),
    ).toEqual({
      keepDays: 30,
      items: [
        { path: ".trash/a.md", from: "a.md", deleted: 5, note: "n1" },
        { path: ".trash/b.md", from: "b.md", deleted: 6 },
      ],
    });
    expect(readTrashRecord({ keepDays: 14, items: "none" })).toEqual({ keepDays: 14, items: [] });
  });
});

describe("numberedPath", () => {
  it("numbers a file's name before its extension", () => {
    expect(numberedPath("a/Plan.md", 1)).toBe("a/Plan.md");
    expect(numberedPath("a/Plan.md", 2)).toBe("a/Plan 2.md");
    expect(numberedPath("a.b/README", 3)).toBe("a.b/README 3");
    expect(numberedPath(".hidden", 2)).toBe(".hidden 2");
  });
});
