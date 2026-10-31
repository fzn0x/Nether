// An import carried out in the vault: in a folder, or under names, the
// vault does not have yet, so nothing in it changes.
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { describe, expect, it } from "vitest";
import type { OpenedImport } from "../src/backend.ts";
import { freeTop, planImport, runImport } from "../src/importNotes.ts";

async function openVault(files: Record<string, string>) {
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, new MemoryStore());
  await vault.open();
  return { memory, vault };
}

function opened(name: string, files: Record<string, string>): OpenedImport & { copied: string[] } {
  const copied: string[] = [];
  return {
    name,
    files: Object.entries(files).map(([path, text]) => ({ path, size: text.length })),
    readText: (path) => Promise.resolve(files[path] ?? ""),
    copyInto: (path, dest) => {
      copied.push(`${path} > ${dest}`);
      return Promise.resolve(dest);
    },
    close: () => Promise.resolve(),
    copied,
  };
}

describe("freeTop", () => {
  it("is a name no note, file or folder at the vault's top has, case aside", async () => {
    const { vault } = await openVault({
      "Old vault/Home.md": "",
      "old vault 2.md": "",
      "Notes/old vault 3.md": "",
      "photo.png": "",
    });
    expect(freeTop(vault, "Old vault")).toBe("Old vault 3");
    expect(freeTop(vault, "photo.png")).toBe("photo.png 2");
    expect(freeTop(vault, "New", new Set(["new"]))).toBe("New 2");
  });
});

describe("importing", () => {
  it("makes a folder's notes and copies its files into a folder of its own", async () => {
    const { memory, vault } = await openVault({ "Vault/Mine.md": "Mine" });
    const source = opened("Vault", { "a.md": "A", "b/c.md": "C", "p.png": "PNG" });
    const planned = await planImport(vault, "folder", source);
    const steps: string[] = [];
    const result = await runImport(vault, source, planned, (done, total) => {
      steps.push(`${String(done)}/${String(total)}`);
    });
    expect(result).toEqual({
      notes: 2,
      files: 1,
      warnings: [],
      folder: "Vault 2",
      first: "Vault 2/a.md",
    });
    expect(steps).toEqual(["1/3", "2/3", "3/3"]);
    expect((await memory.read("Vault 2/b/c.md")).text).toBe("C");
    expect(source.copied).toEqual(["p.png > Vault 2/p.png"]);
    expect((await memory.read("Vault/Mine.md")).text).toBe("Mine");
  });

  it("makes Markdown files a folder named Imported, and each CSV table a database at the top", async () => {
    const { vault } = await openVault({ "Tasks.md": "taken" });
    expect((await planImport(vault, "markdown", opened("a", { "a.md": "A" }))).folder).toBe(
      "Imported",
    );
    const tables = await planImport(
      vault,
      "csv",
      opened("Tasks", { "Tasks.csv": "Name\nA\n", "tasks.CSV": "Name\nB\n" }),
    );
    expect(tables.folder).toBe("");
    expect(tables.plan.notes.map((note) => note.path)).toEqual([
      "Tasks 2.md",
      "Tasks 2/A.md",
      "tasks 3.md",
      "tasks 3/B.md",
    ]);
  });

  it("stops when asked, keeping what it made", async () => {
    const { memory, vault } = await openVault({});
    const source = opened("V", { "a.md": "A", "b.md": "B" });
    const planned = await planImport(vault, "folder", source);
    const controller = new AbortController();
    await expect(
      runImport(
        vault,
        source,
        planned,
        () => {
          controller.abort();
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect((await memory.read("V/a.md")).text).toBe("A");
    expect((await memory.read("V/b.md")).missing).toBe(true);
  });
});
