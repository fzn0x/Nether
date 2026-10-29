import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifestName, writeVault } from "../src/write.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nether-vault-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("writeVault", () => {
  it("writes the notes and a manifest of what it wrote", async () => {
    const folder = join(root, "vault");
    const manifest = await writeVault({ notes: 120, seed: 5 }, folder);
    expect(manifest).toMatchObject({ generator: "@nether/vault-generator", seed: 5, notes: 120 });
    expect(manifest.stats.notes).toBe(120);
    const written = JSON.parse(await readFile(join(folder, manifestName), "utf8")) as unknown;
    expect(written).toEqual(manifest);
    const top = await readdir(folder);
    expect(top).toEqual(expect.arrayContaining(["Daily", "Databases", manifestName]));
  });

  it("replaces a vault it wrote before", async () => {
    const folder = join(root, "vault");
    await writeVault({ notes: 50, seed: 1 }, folder);
    await writeFile(join(folder, "stray.md"), "left over");
    await writeVault({ notes: 50, seed: 1 }, folder);
    expect(await readdir(folder)).not.toContain("stray.md");
  });

  it("refuses a folder that holds anything else", async () => {
    await writeFile(join(root, "my notes.md"), "keep me");
    await expect(writeVault({ notes: 10, seed: 1 }, root)).rejects.toThrow(
      "is not empty and was not made by the vault generator",
    );
    expect(await readFile(join(root, "my notes.md"), "utf8")).toBe("keep me");
  });
});
