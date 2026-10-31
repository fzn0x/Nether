// An encrypted workspace synced by two devices through the real server's
// relay: notes sent and made elsewhere, edits merged both ways, nothing the
// server keeps readable, and a long log replaced by a snapshot.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type KeyPair,
  keyPairOf,
  lockPrivateKey,
  newKeyPair,
  newRecoveryPhrase,
  newWorkspaceKey,
  openKey,
  sealKey,
  unlockPrivateKey,
} from "../src/crypto.ts";
import { RelayChannel } from "../src/relayChannel.ts";
import {
  MemoryStore,
  MemoryVault,
  database,
  device,
  signIn,
  startServer,
  stopAll,
  until,
} from "./harness.ts";

afterEach(stopAll);

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const bytes = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

async function api(url: string, token: string, method: string, path: string, body?: object) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${String(response.status)}`);
  return response.status === 204 ? undefined : ((await response.json()) as Record<string, unknown>);
}

/** A server with an account that has keys, and an encrypted workspace of its own. */
async function encryptedServer() {
  const served = await startServer();
  const me = (await api(served.url, served.token, "GET", "/api/me")) as { user: { id: string } };
  const pair = await newKeyPair();
  const phrase = newRecoveryPhrase();
  await api(served.url, served.token, "PUT", "/api/me/keys", {
    publicKey: b64(pair.publicKey),
    recoveryBox: b64(await lockPrivateKey(pair.privateKey, phrase, me.user.id)),
  });
  const key = await newWorkspaceKey();
  const made = (await api(served.url, served.token, "POST", "/api/workspaces", {
    name: "Secret",
    encryption: "end-to-end",
    sealedKey: b64(await sealKey(key, pair.publicKey)),
  })) as { id: string };
  return { ...served, workspaceId: made.id, userId: me.user.id, phrase, key };
}

/** What a new device does: unlocks the account's key with the phrase, and opens the workspace's. */
async function unlock(
  url: string,
  token: string,
  workspaceId: string,
  userId: string,
  phrase: string,
) {
  const keys = (await api(url, token, "GET", "/api/me/keys")) as { recoveryBox: string };
  const pair: KeyPair = await keyPairOf(
    await unlockPrivateKey(bytes(keys.recoveryBox), phrase, userId),
  );
  const sealed = (await api(url, token, "GET", `/api/workspaces/${workspaceId}/key`)) as {
    version: number;
    sealedKey: string;
  };
  const key = await openKey(bytes(sealed.sealedKey), pair);
  return { key: { version: sealed.version, key }, keys: new Map([[sealed.version, key]]) };
}

describe("an encrypted workspace", () => {
  it("syncs two devices through the relay, and the server keeps nothing it can read", async () => {
    const served = await encryptedServer();
    const laptop = new MemoryVault();
    const plan = laptop.write("Projects/Secret plan.md", "the secret plan");
    const encryption = { key: { version: 1, key: served.key }, keys: new Map([[1, served.key]]) };
    const first = await device(served, served.token, laptop, new MemoryStore(), encryption);
    await until(() => first.engine.status.state === "synced" && first.engine.status.pending === 0);

    // A new device: signed in, and unlocked with the recovery phrase.
    const token = await signIn(served.url);
    const unlocked = await unlock(
      served.url,
      token,
      served.workspaceId,
      served.userId,
      served.phrase,
    );
    const phone = await device(served, token, new MemoryVault(), new MemoryStore(), unlocked);
    await until(() => phone.vault.text(plan) === "the secret plan");
    expect(phone.vault.paths()).toEqual(laptop.paths());

    laptop.edit(plan, (text) => {
      text.insert(text.length, ", step one");
    });
    phone.vault.edit(plan, (text) => {
      text.insert(0, "Step zero, ");
    });
    const merged = "Step zero, the secret plan, step one";
    await until(() => laptop.text(plan) === merged && phone.vault.text(plan) === merged);

    // Nothing in plain text: no document stored as Hocuspocus stores them,
    // and no update holding a title or a word of the note.
    const db = database();
    const plain = await db.query("SELECT 1 FROM documents WHERE workspace_id = $1", [
      served.workspaceId,
    ]);
    expect(plain.rows).toEqual([]);
    const stored = await db.query("SELECT data FROM encrypted_updates WHERE workspace_id = $1", [
      served.workspaceId,
    ]);
    expect(stored.rows.length).toBeGreaterThan(2);
    for (const row of stored.rows) {
      const text = Buffer.from(row.data as Uint8Array).toString("latin1");
      expect(text).not.toContain("secret");
      expect(text).not.toContain("Secret plan");
    }
  });

  it("fails a document's sync on an update it cannot read, and leaves the log as it was", async () => {
    const served = await encryptedServer();
    const keys = { key: { version: 1, key: served.key }, keys: new Map([[1, served.key]]) };
    const where = {
      server: served.url,
      token: served.token,
      workspaceId: served.workspaceId,
      ...keys,
    };
    const events = {
      onSynced: () => undefined,
      onStored: () => undefined,
      onOffline: () => undefined,
    };
    const writer = new RelayChannel(where, new Y.Doc(), events, undefined);
    await until(() => writer.synced);
    const id = randomUUID();
    const note = new Y.Doc();
    for (let edit = 0; edit < 55; edit++) {
      note.getText("content").insert(0, "x");
      await writer.sync(id, note);
    }
    writer.close();
    // A device with another key for the same version, as a key sealed wrong.
    const other = await newWorkspaceKey();
    const wrong = { ...where, key: { version: 1, key: other }, keys: new Map([[1, other]]) };
    const reader = new RelayChannel(wrong, new Y.Doc(), events, undefined);
    await until(() => reader.synced);
    await expect(reader.sync(id, new Y.Doc())).rejects.toThrow(
      "does not open with this workspace's key",
    );
    reader.close();
    const { rows } = await database().query(
      "SELECT count(*)::int AS n FROM encrypted_updates WHERE workspace_id = $1 AND name = $2",
      [served.workspaceId, id],
    );
    expect(rows[0]?.n).toBe(55);
  });

  it("says when its session is refused, and syncs nothing before it is connected", async () => {
    const served = await encryptedServer();
    const keys = { key: { version: 1, key: served.key }, keys: new Map([[1, served.key]]) };
    const offline: (string | undefined)[] = [];
    const events = {
      onSynced: () => undefined,
      onStored: () => undefined,
      onOffline: (error?: string) => {
        offline.push(error);
      },
    };
    const where = {
      server: served.url,
      token: "not-a-token",
      workspaceId: served.workspaceId,
      ...keys,
    };
    const refused = new RelayChannel(where, new Y.Doc(), events, undefined);
    await expect(refused.sync(randomUUID(), new Y.Doc())).rejects.toThrow(
      "Not connected to the server.",
    );
    await until(() => offline.includes("Sign in again."));
    expect(refused.synced).toBe(false);
    refused.close();

    // A workspace the account is not in: its vault document is refused, by name.
    const elsewhere = new RelayChannel(
      { ...where, token: served.token, workspaceId: randomUUID() },
      new Y.Doc(),
      events,
      undefined,
    );
    await until(() =>
      offline.includes("Sign in, as a member of this document's encrypted workspace."),
    );
    expect(elsewhere.synced).toBe(false);
    elsewhere.close();

    // Kept between runs: a channel that starts from its state asks only for what came since.
    const writer = new RelayChannel(
      { ...where, token: served.token },
      new Y.Doc(),
      events,
      undefined,
    );
    await until(() => writer.synced);
    const id = randomUUID();
    const note = new Y.Doc();
    note.getText("content").insert(0, "kept");
    await writer.sync(id, note);
    const state = writer.state();
    writer.close();
    const again = new RelayChannel({ ...where, token: served.token }, new Y.Doc(), events, state);
    await until(() => again.synced);
    await again.sync(id, note);
    expect(again.state()).toEqual(state);
    again.close();
  });

  it("sends an edit made while the document was syncing, the next time", async () => {
    const served = await encryptedServer();
    const keys = { key: { version: 1, key: served.key }, keys: new Map([[1, served.key]]) };
    const where = {
      server: served.url,
      token: served.token,
      workspaceId: served.workspaceId,
      ...keys,
    };
    const events = {
      onSynced: () => undefined,
      onStored: () => undefined,
      onOffline: () => undefined,
    };
    const writer = new RelayChannel(where, new Y.Doc(), events, undefined);
    await until(() => writer.synced);
    const id = randomUUID();
    const note = new Y.Doc();
    note.getText("content").insert(0, "before");
    const syncing = writer.sync(id, note);
    // Typed while the sync waits for the server: its changes were taken already.
    note.getText("content").insert(6, " during");
    await syncing;
    await writer.sync(id, note);
    writer.close();

    const reader = new RelayChannel(where, new Y.Doc(), events, undefined);
    await until(() => reader.synced);
    const copy = new Y.Doc();
    await reader.sync(id, copy);
    reader.close();
    expect(copy.getText("content").toJSON()).toBe("before during");
  });

  it("replaces a document's long log with a snapshot", async () => {
    const served = await encryptedServer();
    const keys = { key: { version: 1, key: served.key }, keys: new Map([[1, served.key]]) };
    const where = {
      server: served.url,
      token: served.token,
      workspaceId: served.workspaceId,
      ...keys,
    };
    const events = {
      onSynced: () => undefined,
      onStored: () => undefined,
      onOffline: () => undefined,
    };
    const writer = new RelayChannel(where, new Y.Doc(), events, undefined);
    await until(() => writer.synced);
    const id = randomUUID();
    const note = new Y.Doc();
    for (let edit = 0; edit < 60; edit++) {
      note.getText("content").insert(0, `${String(edit)} `);
      await writer.sync(id, note);
    }
    writer.close();
    const count = async () =>
      Number(
        (
          await database().query(
            "SELECT count(*)::int AS n FROM encrypted_updates WHERE workspace_id = $1 AND name = $2",
            [served.workspaceId, id],
          )
        ).rows[0]?.n,
      );
    expect(await count()).toBeGreaterThanOrEqual(50);

    // A device reading the long log replaces it with one snapshot.
    const reader = new RelayChannel(where, new Y.Doc(), events, undefined);
    await until(() => reader.synced);
    const copy = new Y.Doc();
    await reader.sync(id, copy);
    expect(copy.getText("content").toJSON()).toBe(note.getText("content").toJSON());
    expect(await count()).toBe(1);
    reader.close();
    // And a third device still reads the whole note from it.
    const late = new RelayChannel(where, new Y.Doc(), events, undefined);
    await until(() => late.synced);
    const third = new Y.Doc();
    await late.sync(id, third);
    late.close();
    expect(third.getText("content").toJSON()).toBe(note.getText("content").toJSON());
  });
});
