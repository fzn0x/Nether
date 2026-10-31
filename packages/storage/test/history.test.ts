// A note's history on this device (ADR 0041): the text a write replaces is
// kept as a version when the last is ten minutes old, listed the latest
// first, and deleted once older than the days the device keeps them.
import { describe, expect, it } from "vitest";
import {
  ChangedOnDisk,
  MemoryFiles,
  MemoryStore,
  Vault,
  defaultHistoryDays,
  sha256,
  versionEvery,
} from "../src/index.ts";

const minute = 60_000;
const day = 86_400_000;

async function openVault(files: Record<string, string>, store = new MemoryStore()) {
  const clock = { now: 1_000 * day };
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, store, { now: () => clock.now });
  await vault.open();
  const id = vault.noteAt("Plan.md")?.id;
  if (id === undefined) throw new Error("No Plan.md");
  return { clock, memory, vault, store, id };
}

describe("a note's history", () => {
  it("keeps the text each spell of editing replaced, ten minutes apart", async () => {
    const { clock, vault, id } = await openVault({ "Plan.md": "one\n" });
    const write = async (text: string) => {
      const file = await vault.read(id);
      await vault.write(id, text, file.hash);
    };
    await write("two\n");
    clock.now += minute;
    await write("three\n");
    clock.now += versionEvery;
    await write("four\n");
    // The same text again keeps nothing.
    clock.now += versionEvery;
    await write("four\n");

    const versions = await vault.versions(id);
    expect(versions.map((version) => version.time)).toEqual([
      1_000 * day + minute + versionEvery,
      1_000 * day,
    ]);
    expect(await vault.versionText(versions[0]?.id ?? 0)).toBe("three\n");
    expect(await vault.versionText(versions[1]?.id ?? 0)).toBe("one\n");
  });

  it("keeps nothing for a write over a change it has not seen", async () => {
    const { memory, vault, id } = await openVault({ "Plan.md": "one\n" });
    memory.edit("Plan.md", "changed by another app\n");
    await expect(vault.write(id, "two\n", await sha256("one\n"))).rejects.toBeInstanceOf(
      ChangedOnDisk,
    );
    expect(await vault.versions(id)).toEqual([]);
  });

  it("goes on from the versions kept before the vault opened again", async () => {
    const store = new MemoryStore();
    const first = await openVault({ "Plan.md": "one\n" }, store);
    await first.vault.write(first.id, "two\n", (await first.vault.read(first.id)).hash);
    const again = new Vault(first.memory, store, { now: () => first.clock.now + minute });
    await again.open();
    await again.write(first.id, "three\n", (await again.read(first.id)).hash);
    expect((await again.versions(first.id)).length).toBe(1);
  });

  it("keeps versions as many days as set, and deletes the older ones", async () => {
    const { clock, vault, id } = await openVault({ "Plan.md": "one\n" });
    expect(await vault.historyDays()).toBe(defaultHistoryDays);
    await vault.write(id, "two\n", (await vault.read(id)).hash);
    clock.now += 5 * day;
    await vault.write(id, "three\n", (await vault.read(id)).hash);

    await vault.setHistoryDays(7);
    expect(await vault.historyDays()).toBe(7);
    await expect(vault.setHistoryDays(0)).rejects.toThrow(/not a number of days/);
    expect(await vault.purgeHistory()).toBe(0);
    clock.now += 3 * day;
    expect(await vault.purgeHistory()).toBe(1);
    expect((await vault.versions(id)).map((version) => version.length)).toEqual([4]);
  });
});
