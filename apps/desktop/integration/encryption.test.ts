// Encryption as the desktop app does it, through a real Nether server: an
// account turns it on and keeps its recovery phrase, makes an encrypted
// workspace and syncs a vault with it; the phrase unlocks the account's key
// again once this device has forgotten it; a second device gets the notes,
// and the server keeps nothing it can read.
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
import { backend } from "../src/backend.ts";
import {
  keepKeys,
  makeEncryptedWorkspace,
  prepareKeys,
  shareWorkspaceKey,
  unlockKeys,
  workspaceEncryption,
} from "../src/encryption.ts";
import { noteComments } from "../src/noteComments.ts";
import { noteDocuments } from "../src/noteDocuments.ts";
import { settingsStore } from "../src/sync.ts";
import { DesktopSyncVault } from "../src/syncVault.ts";
import { freePort } from "@nether/server/test/ports.ts";

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
  await server.listen({ host: "127.0.0.1", port: await freePort() });
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
  const body = (await response.json()) as { token: string; user: { id: string } };
  return { url, token: body.token, userId: body.user.id };
}

async function signIn(url: string): Promise<string> {
  const response = await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.org", password }),
  });
  return ((await response.json()) as { token: string }).token;
}

async function device(
  url: string,
  token: string,
  workspaceId: string,
  files: Record<string, string>,
) {
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, new MemoryStore());
  await vault.open();
  const watching = new AbortController();
  void vault.watch(watching.signal);
  const engine = await VaultSync.start({
    server: url,
    token,
    workspaceId,
    vault: new DesktopSyncVault(vault, noteDocuments(vault), noteComments(vault)),
    store: settingsStore(vault),
    encryption: await workspaceEncryption(url, token, workspaceId),
  });
  stops.push(async () => {
    await engine.stop();
    watching.abort();
  });
  const text = async (path: string) => {
    const file = await memory.read(path);
    return file.missing === true ? undefined : file.text;
  };
  return { engine, text };
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for sync");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("encryption in the desktop app", () => {
  it("turns it on, syncs an encrypted vault, and unlocks it again with the phrase", async () => {
    const served = await startServer();
    const keys = await prepareKeys(served.userId);
    expect(keys.phrase.split(" ")).toHaveLength(24);
    await keepKeys(served.url, served.token, keys);
    expect(await backend.serverKey(served.url)).toEqual(keys.privateKey);

    const secret = await makeEncryptedWorkspace(served.url, served.token, "Secret");
    expect(secret).toMatchObject({ name: "Secret", role: "owner", encrypted: true });
    const plan = "# Plan\n\nThe secret plan.\n";
    const laptop = await device(served.url, served.token, secret.id, { "Plan.md": plan });
    await until(
      () => laptop.engine.status.state === "synced" && laptop.engine.status.pending === 0,
    );

    // This device forgets the key, as a new one has none; the phrase brings it back.
    await backend.forgetServer(served.url);
    expect(await backend.serverKey(served.url)).toBeUndefined();
    const token = await signIn(served.url);
    await expect(workspaceEncryption(served.url, token, secret.id)).rejects.toThrow(
      "Unlock encrypted workspaces on this device first",
    );
    await expect(unlockKeys(served.url, token, served.userId, "too few words")).rejects.toThrow(
      "That is not a recovery phrase",
    );
    const other = await prepareKeys(served.userId);
    await expect(unlockKeys(served.url, token, served.userId, other.phrase)).rejects.toThrow(
      "That recovery phrase does not open this account's key.",
    );
    await unlockKeys(served.url, token, served.userId, keys.phrase.toUpperCase());
    expect(await backend.serverKey(served.url)).toEqual(keys.privateKey);

    const phone = await device(served.url, token, secret.id, {});
    await until(async () => (await phone.text("Plan.md")) !== undefined);
    expect(await phone.text("Plan.md")).toBe("# Plan\n\nThe secret plan.\n");

    // Nothing the server keeps is readable.
    if (db === undefined) throw new Error("No server is running.");
    const database = db;
    const stored = await database.query(
      "SELECT data FROM encrypted_updates WHERE workspace_id = $1",
      [secret.id],
    );
    expect(stored.rows.length).toBeGreaterThan(0);
    for (const row of stored.rows) {
      expect(Buffer.from(row.data as Uint8Array).toString("latin1")).not.toContain("secret plan");
    }
    // No member waits for the key, so there is no one to seal it for.
    expect(
      await shareWorkspaceKey(
        served.url,
        token,
        secret.id,
        await workspaceEncryption(served.url, token, secret.id),
      ),
    ).toBe(0);
  });
});
