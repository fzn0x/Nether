// Two desktop vaults syncing through a real Nether server, on PGlite: the
// sync engine with the vault the desktop app gives it, its open notes and
// what it keeps in the vault's index, checked by the files each writes.
import type { AddressInfo } from "node:net";
import { buildApp } from "@nether/server/src/app.ts";
import { readConfig } from "@nether/server/src/config.ts";
import type { Database } from "@nether/server/src/db.ts";
import { migrate } from "@nether/server/src/migrations.ts";
import { newSetupCode } from "@nether/server/src/setup.ts";
import { testDatabase } from "@nether/server/test/database.ts";
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { VaultSync } from "@nether/sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { noteDocuments } from "../src/noteDocuments.ts";
import { settingsStore } from "../src/sync.ts";
import { DesktopSyncVault } from "../src/syncVault.ts";

const password = "a long password";
const config = readConfig({
  NETHER_DATABASE_URL: "postgres://nether@localhost:5432/nether",
  NETHER_LOG_LEVEL: "silent",
});

let server: Awaited<ReturnType<typeof buildApp>> | undefined;
let db: Database | undefined;
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  await server?.close();
  await db?.close();
  server = undefined;
  db = undefined;
});

async function startServer() {
  db = await testDatabase();
  await migrate(db);
  const setupCode = newSetupCode();
  server = await buildApp(config, { db, setupCode });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${String((server.server.address() as AddressInfo).port)}`;
  const response = await fetch(`${url}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: setupCode,
      name: "Ada",
      email: "ada@example.org",
      password,
      workspace: "Team",
    }),
  });
  const body = (await response.json()) as { workspace: { id: string } };
  return { url, workspaceId: body.workspace.id };
}

/** A device: its vault of files in memory, watched as the app watches it, syncing. */
async function device(served: { url: string; workspaceId: string }, files: Record<string, string>) {
  const signedIn = await fetch(`${served.url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.org", password }),
  });
  const { token } = (await signedIn.json()) as { token: string };
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, new MemoryStore());
  await vault.open();
  const watching = new AbortController();
  void vault.watch(watching.signal);
  const engine = await VaultSync.start({
    server: served.url,
    token,
    workspaceId: served.workspaceId,
    vault: new DesktopSyncVault(vault, noteDocuments(vault)),
    store: settingsStore(vault),
  });
  stops.push(async () => {
    await engine.stop();
    watching.abort();
  });
  const text = async (path: string) => {
    const file = await memory.read(path);
    return file.missing === true ? undefined : file.text;
  };
  return { memory, vault, engine, text };
}

/** Waits until `check` holds, letting servers store and devices write, 20 seconds at most. */
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for sync");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("syncing desktop vaults", () => {
  it("writes a linked vault's notes on another device, with their IDs and their text", async () => {
    const served = await startServer();
    const ideas = "# Ideas\n\nFirst thought.\n";
    const plan = "---\nstatus: draft\n---\n\n# Plan\n\n- One\n- Two\n";
    const laptop = await device(served, { "Ideas.md": ideas, "Projects/Plan.md": plan });
    await until(() => laptop.engine.status.state === "synced");

    const phone = await device(served, {});
    // Written from the note's document, as Nether writes a new note: its
    // text, properties and blocks, in Nether's layout, with no blank line
    // after the frontmatter. The laptop's file keeps its own bytes.
    const written = "---\nstatus: draft\n---\n# Plan\n\n- One\n- Two\n";
    // Notes come a few at a time, in any order: both, then.
    await until(
      async () =>
        (await phone.text("Projects/Plan.md")) === written &&
        (await phone.text("Ideas.md")) !== undefined,
    );
    expect(await phone.text("Ideas.md")).toBe(ideas);
    expect(phone.vault.noteAt("Ideas.md")?.id).toBe(laptop.vault.noteAt("Ideas.md")?.id);
    expect(phone.vault.noteAt("Projects/Plan.md")?.id).toBe(
      laptop.vault.noteAt("Projects/Plan.md")?.id,
    );
  });

  it("brings an edit another app makes to a file on one device to the other's file", async () => {
    const served = await startServer();
    const laptop = await device(served, { "Ideas.md": "# Ideas\n\nFirst thought.\n" });
    await until(() => laptop.engine.status.state === "synced");
    const phone = await device(served, {});
    await until(async () => (await phone.text("Ideas.md")) !== undefined);

    laptop.memory.edit("Ideas.md", "# Ideas\n\nFirst thought.\n\nSecond, from the laptop.\n");
    await until(
      async () =>
        (await phone.text("Ideas.md")) ===
        "# Ideas\n\nFirst thought.\n\nSecond, from the laptop.\n",
    );
    phone.memory.edit(
      "Ideas.md",
      "# Ideas\n\nFirst thought, sharpened.\n\nSecond, from the laptop.\n",
    );
    await until(
      async () =>
        (await laptop.text("Ideas.md")) ===
        "# Ideas\n\nFirst thought, sharpened.\n\nSecond, from the laptop.\n",
    );
  });

  it("moves and trashes on one device the notes moved and removed on the other", async () => {
    const served = await startServer();
    const laptop = await device(served, { "Kept.md": "# Kept\n", "Gone.md": "# Gone\n" });
    await until(() => laptop.engine.status.state === "synced");
    const phone = await device(served, {});
    await until(
      async () =>
        (await phone.text("Gone.md")) !== undefined && (await phone.text("Kept.md")) !== undefined,
    );

    const kept = phone.vault.noteAt("Kept.md");
    if (kept === undefined) throw new Error("No Kept.md on the phone");
    await phone.vault.rename(kept.id, "Archive/Kept.md");
    const gone = laptop.vault.noteAt("Gone.md");
    if (gone === undefined) throw new Error("No Gone.md on the laptop");
    await laptop.vault.remove(gone.id);
    await until(
      async () =>
        (await laptop.text("Archive/Kept.md")) === "# Kept\n" &&
        (await phone.text("Gone.md")) === undefined,
    );
    expect(await laptop.text("Kept.md")).toBeUndefined();
    // Removed elsewhere, it waits in this device's trash.
    expect(await phone.text(".trash/Gone.md")).toBe("# Gone\n");
  });
});
