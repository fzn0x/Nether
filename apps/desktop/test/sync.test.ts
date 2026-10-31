// What this device keeps of a vault's sync, in the vault's index: its link
// to a workspace and what sync knows; and how sync is going, in words.
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { describe, expect, it } from "vitest";
import { setVaultLink, settingsStore, syncSummary, vaultLink } from "../src/sync.ts";

async function openVault() {
  const vault = new Vault(new MemoryFiles({ "Ideas.md": "# Ideas\n" }), new MemoryStore());
  await vault.open();
  return vault;
}

const link = {
  server: "https://nether.example.org",
  workspaceId: "w1",
  workspaceName: "Team",
};

describe("a vault's link and sync record", () => {
  it("keeps the link, and forgets what sync knew when it changes", async () => {
    const vault = await openVault();
    expect(await vaultLink(vault)).toBeUndefined();
    await setVaultLink(vault, link);
    expect(await vaultLink(vault)).toEqual(link);

    const store = settingsStore(vault);
    expect(await store.load()).toBeUndefined();
    await store.save({
      cursor: 7,
      base: { a: "A.md" },
      pending: ["b"],
      files: { "photo.png": "ab" },
      vault: new Uint8Array([1, 2]),
      channel: { a: { cursor: 3, sent: "AA==" } },
    });
    const loaded = await store.load();
    expect(loaded).toMatchObject({
      cursor: 7,
      base: { a: "A.md" },
      pending: ["b"],
      files: { "photo.png": "ab" },
      channel: { a: { cursor: 3, sent: "AA==" } },
    });
    expect([...(loaded?.vault ?? [])]).toEqual([1, 2]);

    await setVaultLink(vault, undefined);
    expect(await vaultLink(vault)).toBeUndefined();
    expect(await store.load()).toBeUndefined();
  });

  it("keeps the units, and each one's vault document, letting go of those gone", async () => {
    const vault = await openVault();
    await setVaultLink(vault, link);
    const store = settingsStore(vault);
    const units = [
      { id: "general", kind: "general", level: "full", document: "vault" },
      { id: "t1", kind: "team", level: "edit", document: "vault.t1", name: "Design" },
    ] as const;
    await store.save({
      cursor: 1,
      base: {},
      pending: [],
      vault: new Uint8Array([1]),
      units,
      vaults: { t1: new Uint8Array([2]), t2: new Uint8Array([3]) },
    });
    const loaded = await store.load();
    expect(loaded?.units).toEqual(units);
    expect(Object.keys(loaded?.vaults ?? {}).sort()).toEqual(["t1", "t2"]);
    expect([...(loaded?.vaults?.t2 ?? [])]).toEqual([3]);

    await store.save({
      cursor: 2,
      base: {},
      pending: [],
      vault: null,
      vaults: { t1: new Uint8Array([4]) },
    });
    expect(await vault.settings.setting("sync.vault.t2")).toBeUndefined();
    await setVaultLink(vault, undefined);
    expect(await vault.settings.setting("sync.vault.t1")).toBeUndefined();
  });

  it("reads no link from a setting it cannot read", async () => {
    const vault = await openVault();
    await vault.settings.setSetting("sync.link", new TextEncoder().encode("not json"));
    expect(await vaultLink(vault)).toBeUndefined();
    await vault.settings.setSetting("sync.link", new TextEncoder().encode('{"server":1}'));
    expect(await vaultLink(vault)).toBeUndefined();
  });
});

describe("syncSummary", () => {
  it("says how sync is going", () => {
    expect(syncSummary(link, undefined, true)).toBe("Sign in to nether.example.org again to sync.");
    expect(syncSummary(link, undefined, false)).toBe("Connecting to Team…");
    expect(syncSummary(link, { state: "offline", pending: 2 }, false)).toBe(
      "Offline: changes wait to sync with Team.",
    );
    expect(syncSummary(link, { state: "offline", pending: 0, error: "Refused" }, false)).toBe(
      "Not synced with Team: Refused",
    );
    expect(syncSummary(link, { state: "syncing", pending: 0 }, false)).toBe("Syncing with Team…");
    expect(syncSummary(link, { state: "synced", pending: 3 }, false)).toBe(
      "Syncing with Team: 3 to send.",
    );
    expect(syncSummary(link, { state: "synced", pending: 0 }, false)).toBe("Synced with Team.");
    expect(syncSummary(link, { state: "synced", pending: 0, refused: ["video.mp4"] }, false)).toBe(
      "Synced with Team, but for video.mp4, which the server would not take.",
    );
    expect(
      syncSummary(
        link,
        { state: "synced", pending: 0, refused: ["a.mp4", "b.mp4", "c.mp4"] },
        false,
      ),
    ).toBe("Synced with Team, but for a.mp4 and 2 other files, which the server would not take.");
  });
});
