import type { NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import {
  ChangedOnDisk,
  type FileInfo,
  type IndexStore,
  MemoryFiles,
  MemoryStore,
  SqliteStore,
  Vault,
  matchMoves,
  sha256,
} from "../src/index.ts";
import { nodeDatabase } from "./node-database.ts";

function ids(): () => NoteId {
  let next = 0;
  return () => `01929f4c-7b00-7a00-8000-${String(++next).padStart(12, "0")}` as NoteId;
}

async function openVault(files: MemoryFiles, store: IndexStore = new MemoryStore(), newId = ids()) {
  const vault = new Vault(files, store, { newId });
  await vault.open();
  return vault;
}

function firstNote(vault: Vault): NoteId {
  const note = vault.notes()[0];
  if (note === undefined) throw new Error("The vault has no notes.");
  return note.id;
}

function paths(vault: Vault): string[] {
  return vault.notes().map((note) => note.path);
}

describe("Vault.open", () => {
  it("gives every Markdown file a note ID and sorts notes as a file explorer does", async () => {
    const files = new MemoryFiles({
      "Note 10.md": "x",
      "Note 2.md": "x",
      "b/a.md": "x",
      "Apple.md": "x",
      "image.png": "x",
      ".obsidian/workspace.md": "x",
    });
    const vault = await openVault(files);
    expect(paths(vault)).toEqual(["Apple.md", "b/a.md", "Note 2.md", "Note 10.md"]);
    expect(vault.notes().map((note) => note.title)).toEqual(["Apple", "a", "Note 2", "Note 10"]);
    expect(new Set(vault.notes().map((note) => note.id)).size).toBe(4);
  });

  it("keeps note IDs in the index across opens", async () => {
    const files = new MemoryFiles({ "a.md": "A", "b.md": "B" });
    const store = await SqliteStore.open(nodeDatabase());
    const first = await openVault(files, store);
    const second = await openVault(files, store, () => {
      throw new Error("no new IDs are needed");
    });
    expect(second.notes()).toEqual(first.notes());
  });

  it("catches up with what changed while the vault was closed, keeping the IDs of moved notes", async () => {
    const files = new MemoryFiles({ "a.md": "A", "folder/b.md": "B", "c.md": "C" });
    const store = new MemoryStore();
    const newId = ids();
    const first = await openVault(files, store, newId);
    const idOf = (path: string) => first.noteAt(path)?.id;
    const [a, b] = [idOf("a.md"), idOf("folder/b.md")];
    // While closed: edit a, move b, delete c, add d. Without a watch, no events arrive.
    files.move("folder/b.md", "elsewhere/b.md", []);
    files.edit("a.md", "A changed");
    files.edit("c.md", undefined);
    files.edit("d.md", "D");
    const second = await openVault(files, store, newId);
    expect(paths(second)).toEqual(["a.md", "d.md", "elsewhere/b.md"]);
    expect(second.noteAt("a.md")?.id).toBe(a);
    expect(second.noteAt("a.md")?.size).toBe(9);
    expect(second.noteAt("elsewhere/b.md")?.id).toBe(b);
  });
});

describe("Vault notes", () => {
  it("reads, writes and refuses a write over a change it has not seen", async () => {
    const files = new MemoryFiles({ "a.md": "one" });
    const vault = await openVault(files);
    const id = firstNote(vault);
    const read = await vault.read(id);
    expect(read.text).toBe("one");
    const written = await vault.write(id, "two", read.hash);
    expect(written.hash).toBe(await sha256("two"));
    expect(vault.note(id)?.size).toBe(3);
    files.edit("a.md", "three");
    await expect(vault.write(id, "four", written.hash)).rejects.toBeInstanceOf(ChangedOnDisk);
    expect((await files.read("a.md")).text).toBe("three");
  });

  it("makes a note with the ID it is given, unless another note has it", async () => {
    const files = new MemoryFiles({});
    const vault = await openVault(files);
    const id = "01929f4c-7b00-7a00-8000-0000000000aa" as NoteId;
    const made = await vault.create("From the server.md", "# Hello", id);
    expect(made.id).toBe(id);
    expect(vault.noteAt("From the server.md")?.id).toBe(id);
    const again = await vault.create("Another.md", "# Another", id);
    expect(again.id).not.toBe(id);
  });

  it("creates, renames and removes notes, keeping an ID through a rename", async () => {
    const files = new MemoryFiles({});
    const vault = await openVault(files);
    const created = await vault.create("Ideas.md", "# Ideas");
    expect(vault.noteAt("Ideas.md")?.id).toBe(created.id);
    await expect(vault.create("Ideas.md", "again")).rejects.toThrow(/already there/);
    await expect(vault.create("photo.png", "x")).rejects.toThrow(/not a Markdown file/);
    const renamed = await vault.rename(created.id, "Projects/Ideas.md");
    expect(renamed).toMatchObject({ id: created.id, path: "Projects/Ideas.md", title: "Ideas" });
    expect(vault.noteAt("Ideas.md")).toBeUndefined();
    expect(await vault.remove(created.id)).toBe(".trash/Ideas.md");
    expect(vault.notes()).toEqual([]);
    expect(vault.note(created.id)).toBeUndefined();
    await expect(vault.read(created.id)).rejects.toThrow(/has no note/);
  });

  it("tells its listeners about every change", async () => {
    const vault = await openVault(new MemoryFiles({}));
    let calls = 0;
    const stop = vault.subscribe(() => calls++);
    await vault.create("a.md", "A");
    stop();
    await vault.create("b.md", "B");
    expect(calls).toBe(1);
  });

  it("reads and writes a file that is not a note, refusing a write over a change it has not seen", async () => {
    const files = new MemoryFiles({ "Projects.md": "A database" });
    const vault = await openVault(files);
    const first = await vault.writeFile("Projects.base", "views: []\n", "");
    expect(vault.files()).toContain("Projects.base");
    expect((await vault.readFile("Projects.base")).text).toBe("views: []\n");
    const second = await vault.writeFile("Projects.base", "views:\n  - type: table\n", first.hash);
    expect(second.hash).toBe(await sha256("views:\n  - type: table\n"));
    files.edit("Projects.base", "edited in Obsidian\n");
    await expect(vault.writeFile("Projects.base", "again\n", second.hash)).rejects.toBeInstanceOf(
      ChangedOnDisk,
    );
    // A new file's write finds one there.
    await expect(vault.writeFile("Projects.base", "new\n", "")).rejects.toThrow(/already there/);
    await expect(vault.writeFile("Notes.md", "x", "")).rejects.toThrow(/is a note/);
    expect((await vault.readFile("Missing.base")).missing).toBe(true);
  });

  it("reads and writes a file's bytes, keeping its hash, and sends one that is not a note to the trash", async () => {
    const files = new MemoryFiles({ "Note.md": "x", "a.png": "old" });
    const vault = await openVault(files);
    expect(vault.attachments()).toEqual(["a.png"]);
    const hash = await vault.fileHash("a.png");
    expect(hash).toBe(await sha256("old"));
    expect(await vault.fileHash("gone.png")).toBeUndefined();

    const png = new Uint8Array([137, 80, 78, 71, 0, 255]);
    const written = await vault.writeBytes("a.png", png, hash ?? "");
    expect(written.hash).toBe(await sha256(png));
    // Known from the write, not read again.
    expect(await vault.fileHash("a.png")).toBe(written.hash);
    expect((await vault.readBytes("a.png")).bytes).toEqual(png);
    await expect(vault.writeBytes("a.png", png, hash ?? "")).rejects.toBeInstanceOf(ChangedOnDisk);
    await expect(vault.writeBytes("b.md", png, "")).rejects.toThrow(/is a note/);
    // Text written as bytes reads back as text.
    await vault.writeBytes("c.txt", new TextEncoder().encode("plain"), "");
    expect((await vault.readFile("c.txt")).text).toBe("plain");
    // A change another app makes is read again.
    files.edit("c.txt", "changed");
    await vault.apply([{ op: "write", path: "c.txt", isDir: false }]);
    expect(await vault.fileHash("c.txt")).toBe(await sha256("changed"));

    await expect(vault.removeFile("Note.md")).rejects.toThrow(/is a note/);
    const where = await vault.removeFile("a.png");
    expect(vault.attachments()).toEqual(["c.txt"]);
    expect(await vault.trash()).toEqual([
      { path: where, from: "a.png", deleted: expect.any(Number) as number },
    ]);
    expect((await files.readBytes(where)).bytes).toEqual(png);
    await expect(files.readBytes("a.png")).rejects.toThrow(/not there/);
  });

  it("tells its listeners which notes each change added, changed, moved or removed", async () => {
    const vault = await openVault(new MemoryFiles({ "a.md": "A", "b.md": "B" }));
    const [a, b] = vault.notes().map((note) => note.id);
    if (a === undefined || b === undefined) throw new Error("The vault has not two notes.");
    const told: (readonly NoteId[])[] = [];
    vault.subscribe((changed) => told.push(changed));
    const read = await vault.read(a);
    await vault.write(a, "A again", read.hash);
    await vault.rename(b, "Folder/b.md");
    const created = await vault.create("c.md", "C");
    await vault.remove(a);
    expect(told).toEqual([[a], [b], [created.id], [a]]);
  });

  it("keeps the hash a note's first read learns, telling no one, as nothing they see changed", async () => {
    const store = new MemoryStore();
    const vault = await openVault(new MemoryFiles({ "a.md": "one" }), store);
    const id = firstNote(vault);
    const notes = vault.notes();
    let calls = 0;
    vault.subscribe(() => calls++);
    const read = await vault.read(id);
    expect(calls).toBe(0);
    expect(vault.notes()).toBe(notes);
    expect((await store.files()).find((file) => file.path === "a.md")?.hash).toBe(read.hash);
    await vault.write(id, "two", read.hash);
    expect(calls).toBe(1);
  });
});

describe("Vault.watch", () => {
  async function watched(files: MemoryFiles, applied?: () => void) {
    const vault = await openVault(files);
    const controller = new AbortController();
    const done = vault.watch(controller.signal, applied);
    return { vault, stop: async () => (controller.abort(), done) };
  }

  it("follows files that other apps create, change and delete", async () => {
    const files = new MemoryFiles({ "a.md": "A" });
    let batches = 0;
    const { vault, stop } = await watched(files, () => batches++);
    files.edit("b.md", "B");
    files.edit("a.md", "A longer");
    files.edit(".hidden.md", "H");
    await vault.settled();
    expect(paths(vault)).toEqual(["a.md", "b.md"]);
    // Told once each batch is in the index; the hidden file's is not reported.
    expect(batches).toBe(2);
    expect(vault.noteAt("a.md")?.size).toBe(8);
    files.edit("b.md", undefined);
    await vault.settled();
    expect(paths(vault)).toEqual(["a.md"]);
    await stop();
    files.edit("c.md", "C");
    await vault.settled();
    expect(paths(vault)).toEqual(["a.md"]);
  });

  it("keeps a note's ID when another app renames it, as a rename or as a removal and a creation", async () => {
    const files = new MemoryFiles({ "a.md": "A", "b.md": "B" });
    const { vault, stop } = await watched(files);
    const [a, b] = [vault.noteAt("a.md")?.id, vault.noteAt("b.md")?.id];
    files.move("a.md", "x/a.md", [{ op: "rename", path: "x/a.md", oldPath: "a.md", isDir: false }]);
    files.move("b.md", "y/b.md", [
      { op: "remove", path: "b.md", isDir: false },
      { op: "create", path: "y/b.md", isDir: false },
    ]);
    await vault.settled();
    expect(vault.noteAt("x/a.md")?.id).toBe(a);
    expect(vault.noteAt("y/b.md")?.id).toBe(b);
    await stop();
  });

  it("moves every note of a renamed folder and drops those of a removed one", async () => {
    const files = new MemoryFiles({ "f/a.md": "A", "f/g/b.md": "B", "other.md": "O" });
    const { vault, stop } = await watched(files);
    const a = vault.noteAt("f/a.md")?.id;
    files.move("f/a.md", "h/a.md", []);
    files.move("f/g/b.md", "h/g/b.md", [{ op: "rename", path: "h", oldPath: "f", isDir: true }]);
    await vault.settled();
    expect(paths(vault)).toEqual(["h/a.md", "h/g/b.md", "other.md"]);
    expect(vault.noteAt("h/a.md")?.id).toBe(a);
    files.move("h/a.md", ".gone/a.md", []);
    files.move("h/g/b.md", ".gone/b.md", [{ op: "remove", path: "h", isDir: true }]);
    await vault.settled();
    expect(paths(vault)).toEqual(["other.md"]);
    await stop();
  });

  it("lists a folder again when the system cannot say what changed in it", async () => {
    const files = new MemoryFiles({ "f/a.md": "A" });
    const { vault, stop } = await watched(files);
    files.move("f/a.md", "f/renamed.md", [{ op: "rescan", path: "f", isDir: true }]);
    await vault.settled();
    expect(paths(vault)).toEqual(["f/renamed.md"]);
    await stop();
  });

  it("treats a move into the trash as a removal and a move out of it as a new note", async () => {
    const files = new MemoryFiles({ "a.md": "A" });
    const { vault, stop } = await watched(files);
    files.move("a.md", ".trash/a.md", [
      { op: "rename", path: ".trash/a.md", oldPath: "a.md", isDir: false },
    ]);
    await vault.settled();
    expect(paths(vault)).toEqual([]);
    files.move(".trash/a.md", "a.md", [
      { op: "rename", path: "a.md", oldPath: ".trash/a.md", isDir: false },
    ]);
    await vault.settled();
    expect(paths(vault)).toEqual(["a.md"]);
    await stop();
  });

  it("ignores its own writes coming back from the watch", async () => {
    const files = new MemoryFiles({ "a.md": "one" });
    const { vault, stop } = await watched(files);
    const id = firstNote(vault);
    const read = await vault.read(id);
    let calls = 0;
    vault.subscribe(() => calls++);
    await vault.write(id, "two", read.hash);
    await vault.settled();
    expect(calls).toBe(1);
    await stop();
  });
});

describe("matchMoves", () => {
  const file = (path: string, size = 1, modified = 1): FileInfo => ({ path, size, modified });

  it("pairs by size, time and kind, preferring the same name", () => {
    const matches = matchMoves(
      [
        { path: "old/a.md", size: 1, modified: 1 },
        { path: "old/b.md", size: 1, modified: 1 },
        { path: "pic.png", size: 1, modified: 1 },
      ],
      [file("new/b.md"), file("new/a.md"), file("pic.jpg")],
    );
    expect(matches.get("new/a.md")?.path).toBe("old/a.md");
    expect(matches.get("new/b.md")?.path).toBe("old/b.md");
    expect(matches.has("pic.jpg")).toBe(false);
  });

  it("pairs each new file once", () => {
    const matches = matchMoves(
      [
        { path: "a.md", size: 1, modified: 1 },
        { path: "b.md", size: 1, modified: 1 },
      ],
      [file("c.md")],
    );
    expect(matches.size).toBe(1);
  });
});

describe("Vault.notes", () => {
  it("keeps the order of notes when a change moves none, and gives their new sizes", async () => {
    const files = new MemoryFiles({ "b.md": "B", "a.md": "A", "c.md": "C" });
    const vault = await openVault(files);
    const before = vault.notes();
    const b = vault.noteAt("b.md");
    if (b === undefined) throw new Error("No note at b.md.");
    const read = await vault.read(b.id);
    await vault.write(b.id, "B, longer", read.hash);
    const after = vault.notes();
    expect(after).not.toBe(before);
    expect(after.map((note) => note.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(after[1]).toMatchObject({ id: b.id, size: 9 });
    // The notes that did not change are the same objects.
    expect(after[0]).toBe(before[0]);
    await vault.create("0.md", "zero");
    expect(vault.notes().map((note) => note.path)).toEqual(["0.md", "a.md", "b.md", "c.md"]);
  });
});

describe("Vault.moveFile", () => {
  it("moves a file of any kind, a note keeping its ID", async () => {
    const files = new MemoryFiles({ "a/x.png": "png", "a/n.md": "N", "b.md": "B" });
    const vault = await openVault(files);
    const note = vault.noteAt("a/n.md")?.id;
    await vault.moveFile("a/x.png", "c/x.png");
    await vault.moveFile("a/n.md", "c/n.md");
    expect(vault.files()).toEqual(["b.md", "c/n.md", "c/x.png"]);
    expect(vault.noteAt("c/n.md")?.id).toBe(note);
    expect((await files.read("c/x.png")).missing).toBeUndefined();
    await expect(vault.moveFile("b.md", "c/n.md")).rejects.toThrow(/already there/);
  });
});

describe("Vault.files", () => {
  it("lists every file it holds, notes and others, as a file explorer sorts them", async () => {
    const vault = await openVault(
      new MemoryFiles({
        "b.md": "B",
        "a/x 10.png": "",
        "a/x 9.png": "",
        ".nether/vault.json": "{}",
      }),
    );
    expect(vault.files()).toEqual(["a/x 9.png", "a/x 10.png", "b.md"]);
  });
});

describe("MemoryFiles", () => {
  it("refuses paths that are not in the vault", async () => {
    const files = new MemoryFiles({});
    for (const path of ["", "/a.md", "../a.md", "a//b.md", "a\\b.md", "./a.md"]) {
      await expect(files.read(path)).rejects.toThrow(/not a path/);
    }
    expect(() => new MemoryFiles({ "../x.md": "x" })).toThrow(/not a path/);
  });

  it("lists one folder, stats what is there and reports a missing read", async () => {
    const files = new MemoryFiles({ "a.md": "A", "f/b.md": "B", "f/.c.md": "C" });
    const listed: string[] = [];
    await files.list("f", (batch) => listed.push(...batch.map((item) => item.path)));
    expect(listed).toEqual(["f/b.md"]);
    await files.list("empty", () => listed.push("never"));
    expect(listed).toEqual(["f/b.md"]);
    expect((await files.stat(["a.md", "gone.md"])).map((item) => item.path)).toEqual(["a.md"]);
    expect(await files.read("gone.md")).toMatchObject({ missing: true });
  });

  it("refuses renames over a file and of a file that is gone, but allows a change of case", async () => {
    const files = new MemoryFiles({ "a.md": "A", "b.md": "B" });
    await expect(files.rename("a.md", "b.md")).rejects.toThrow(/already there/);
    await expect(files.rename("gone.md", "c.md")).rejects.toThrow(/not there/);
    await expect(files.rename("a.md", "A.md")).resolves.toMatchObject({ path: "A.md" });
    await expect(files.remove("gone.md")).rejects.toThrow(/not there/);
    expect(() => {
      files.move("gone.md", "x.md", []);
    }).toThrow(/not there/);
  });

  it("lists the trash, hidden only below it, and erases only from it", async () => {
    const files = new MemoryFiles({ "a.md": "A", ".trash/b.md": "B", ".trash/.c/d.md": "D" });
    const listed: string[] = [];
    await files.list(".trash", (batch) => listed.push(...batch.map((item) => item.path)));
    expect(listed).toEqual([".trash/b.md"]);
    await expect(files.erase("a.md")).rejects.toThrow(/not in the trash/);
    await expect(files.erase(".trash/gone.md")).rejects.toThrow(/not there/);
    await files.erase(".trash/b.md");
    expect(await files.read(".trash/b.md")).toMatchObject({ missing: true });
    expect(await files.read("a.md")).toMatchObject({ text: "A" });
  });

  it("stops a watch that is aborted before it starts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new MemoryFiles({}).watch(() => undefined, controller.signal),
    ).resolves.toBeUndefined();
  });
});

describe("Vault.folders", () => {
  it("has the folders on disk, empty ones too, and not hidden ones", async () => {
    const files = new MemoryFiles({ "a/b/note.md": "x", ".nether/data.json": "{}" });
    await files.makeFolder("empty");
    const vault = await openVault(files);
    expect(vault.folders()).toEqual(["a", "a/b", "empty"]);
  });

  it("makes and removes folders, telling its listeners, and keeps one a note leaves", async () => {
    const vault = await openVault(new MemoryFiles({ "note.md": "x" }));
    let told = 0;
    vault.subscribeFolders(() => {
      told++;
    });
    await vault.makeFolder("Projects/Website");
    expect(vault.folders()).toEqual(["Projects", "Projects/Website"]);
    expect(told).toBe(1);
    await expect(vault.makeFolder("Projects")).rejects.toThrow();
    await expect(vault.makeFolder(".secret")).rejects.toThrow();
    await expect(vault.removeFolder("Projects")).rejects.toThrow(/not empty/);

    // A note moved into a folder, then out, leaves the folder, as the disk does.
    const id = firstNote(vault);
    await vault.rename(id, "Moved/note.md");
    expect(vault.folders()).toContain("Moved");
    await vault.rename(id, "note.md");
    expect(vault.folders()).toContain("Moved");

    await vault.removeFolder("Projects/Website");
    expect(vault.folders()).toEqual(["Moved", "Projects"]);
    // The same list until the folders change.
    expect(vault.folders()).toBe(vault.folders());
  });

  it("follows a folder made or removed by another app", async () => {
    const files = new MemoryFiles({ "note.md": "x" });
    const vault = await openVault(files);
    await files.makeFolder("Outside");
    await vault.apply([{ op: "create", path: "Outside", isDir: true }]);
    expect(vault.folders()).toEqual(["Outside"]);
    await files.removeFolder("Outside");
    await vault.apply([{ op: "remove", path: "Outside", isDir: true }]);
    expect(vault.folders()).toEqual([]);
  });
});
