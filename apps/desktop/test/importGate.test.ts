// The Phase 2 gate's Obsidian half: a vault of the reference generator's
// notes, written as Obsidian writes them, imported as the app imports a
// folder, every note in the vault afterwards byte for byte as it was. The
// Notion half is @nether/markdown's notion.test.ts, every word of every page.
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { generateVault } from "@nether/vault-generator";
import { describe, expect, it } from "vitest";
import type { OpenedImport } from "../src/backend.ts";
import { planImport, runImport } from "../src/importNotes.ts";

/** How many notes the gate imports: the reference vault's own number with NETHER_GATE_NOTES. */
const env = import.meta.env as Readonly<Record<string, string | undefined>>;
const notes = Number(env.NETHER_GATE_NOTES ?? "2000");

describe("importing an Obsidian vault", () => {
  it(`loses no text: ${String(notes)} notes come over byte for byte`, async () => {
    const files = new Map<string, string>();
    for (const file of generateVault({ notes, seed: 1 })) files.set(file.path, file.content);
    const opened: OpenedImport = {
      name: "Reference vault",
      files: [...files].map(([path, text]) => ({ path, size: text.length })),
      readText: (path) => Promise.resolve(files.get(path) ?? ""),
      copyInto: () => Promise.reject(new Error("The reference vault has only notes.")),
      close: () => Promise.resolve(),
    };
    const memory = new MemoryFiles({ "Mine.md": "Mine" });
    const vault = new Vault(memory, new MemoryStore());
    await vault.open();
    const result = await runImport(vault, opened, await planImport(vault, "folder", opened));
    expect(result.notes).toBe(files.size);
    expect(result.warnings).toEqual([]);
    for (const [path, text] of files) {
      const read = await memory.read(`Reference vault/${path}`);
      expect(read.text, path).toBe(text);
    }
    expect((await memory.read("Mine.md")).text).toBe("Mine");
  }, 600_000);
});
