import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type VaultFile, emptyStats, generateVault } from "../src/generate.ts";

const small = { notes: 300, seed: 1 };

function files(options = small): VaultFile[] {
  return [...generateVault(options)];
}

function digest(vault: readonly VaultFile[]): string {
  const hash = createHash("sha256");
  for (const file of vault) hash.update(`${file.path}\n${file.content}\n`);
  return hash.digest("hex");
}

const titleOf = (path: string) => path.slice(path.lastIndexOf("/") + 1, -".md".length);

describe("generateVault", () => {
  it("writes the same files for the same seed and size", () => {
    expect(digest(files())).toBe(digest(files()));
    expect(digest(files({ notes: 300, seed: 2 }))).not.toBe(digest(files()));
  });

  it("matches the reference output of this generator version", () => {
    // Changing the output for a seed changes the reference vault that
    // performance numbers are compared on: bump generatorVersion with it.
    expect(digest(files())).toBe(
      "8607bbabff3bdf52b425a3e09d3c7c62f37ba627192a36da8d08b812a93d0c6c",
    );
  });

  it("writes exactly the notes asked for: daily notes, database rows and the rest", () => {
    const stats = emptyStats();
    const vault = [...generateVault({ notes: 1000, seed: 3 }, stats)];
    expect(vault).toHaveLength(1000);
    expect(stats).toMatchObject({ notes: 1000, dailyNotes: 30, databaseRows: 100 });
    expect(vault.filter((file) => file.path.startsWith("Daily/"))).toHaveLength(30);
    expect(vault.filter((file) => file.path.startsWith("Databases/Tasks/"))).toHaveLength(20);
    expect(stats.bytes).toBe(vault.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0));
  });

  it("gives every note a path that works on Windows, macOS and Linux, unique without case", () => {
    const paths = files().map((file) => file.path);
    for (const path of paths) {
      expect(path).toMatch(/^[A-Za-z0-9 ./-]+\.md$/);
      expect(path.split("/").every((part) => part.trim() === part && !part.endsWith("."))).toBe(
        true,
      );
    }
    expect(new Set(paths.map((path) => titleOf(path).toLowerCase())).size).toBe(paths.length);
  });

  it("links only to notes, headings and blocks that exist, apart from a few unwritten notes", () => {
    const vault = files();
    const byTitle = new Map(vault.map((file) => [titleOf(file.path), file.content]));
    let links = 0;
    for (const file of vault) {
      for (const [, target] of file.content.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
        links++;
        const [reference = ""] = (target ?? "").split("|");
        const [title = "", heading] = reference.split("#");
        const [note = "", block] = title.split("^");
        if (note.startsWith("Unwritten ")) continue;
        const content = byTitle.get(note);
        expect(content, `${file.path} links to ${note}`).toBeDefined();
        if (heading !== undefined) expect(content).toContain(`\n## ${heading}\n`);
        if (block !== undefined) expect(content).toContain(` ^${block}\n`);
      }
    }
    expect(links).toBeGreaterThan(300);
  });

  it("closes every frontmatter block and repeats no key in it", () => {
    for (const file of files()) {
      if (!file.content.startsWith("---\n")) continue;
      const end = file.content.indexOf("\n---\n", 4);
      expect(end, file.path).toBeGreaterThan(0);
      const keys = file.content
        .slice(4, end)
        .split("\n")
        .map((line) => line.slice(0, line.indexOf(":")));
      expect(new Set(keys).size, file.path).toBe(keys.length);
    }
  });

  it("refuses a size below one note", () => {
    expect(() => [...generateVault({ notes: 0, seed: 1 })]).toThrow(RangeError);
  });
});
