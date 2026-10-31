// Two devices syncing one vault through a real Nether server, on PGlite:
// linking a vault and opening it elsewhere, edits both ways and at once,
// notes made, moved and removed, edits made offline, and stopping.
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { HocuspocusChannel } from "../src/channel.ts";
import { newWorkspaceKey } from "../src/crypto.ts";
import type { HeldDocument } from "../src/engine.ts";
import { RelayChannel } from "../src/relayChannel.ts";
import { MemoryVault, device, signIn, startServer, stopAll, until } from "./harness.ts";

afterEach(stopAll);

describe("syncing a vault", () => {
  it("sends a linked vault's notes, and makes them on another device with their IDs", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const ideas = laptop.write("Ideas.md", "# Ideas");
    const plan = laptop.write("Projects/Plan.md", "# Plan");
    const first = await device(served, served.token, laptop);
    await until(() => first.engine.status.state === "synced");

    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.notes.size === 2);
    expect(phone.vault.paths()).toEqual(laptop.paths());
    expect(phone.vault.text(ideas)).toBe("# Ideas");
    expect(phone.vault.text(plan)).toBe("# Plan");
    // What the device knows is kept: the agreed paths, and nothing left to send.
    await until(() => (first.store.record?.pending.length ?? -1) === 0);
    expect(first.store.record?.base).toEqual(Object.fromEntries(laptop.paths()));
  });

  it("sends edits both ways, and merges edits made on both at once", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const note = laptop.write("Ideas.md", "middle");
    await device(served, served.token, laptop);
    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.text(note) === "middle");

    laptop.edit(note, (text) => {
      text.insert(text.length, " end");
    });
    phone.vault.edit(note, (text) => {
      text.insert(0, "start ");
    });
    await until(
      () =>
        laptop.text(note) === "start middle end" && phone.vault.text(note) === "start middle end",
    );
  });

  it("makes, moves and removes on one device what another did", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const kept = laptop.write("Kept.md", "kept");
    const gone = laptop.write("Gone.md", "gone");
    await device(served, served.token, laptop);
    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.notes.size === 2);

    const fresh = laptop.write("Fresh.md", "fresh");
    phone.vault.rename(kept, "Archive/Kept.md");
    laptop.delete(gone);
    await until(
      () =>
        phone.vault.text(fresh) === "fresh" &&
        laptop.paths().get(kept) === "Archive/Kept.md" &&
        !phone.vault.notes.has(gone),
    );
    expect(phone.vault.paths()).toEqual(laptop.paths());
  });

  it("keeps a note moved here while other notes were still being fetched", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const first = laptop.write("First.md", "one");
    laptop.write("Second.md", "two");
    await device(served, served.token, laptop);

    // The person moves the first note as soon as it comes, before the round ends.
    class Hasty extends MemoryVault {
      override async create(id: string, path: string, state: Uint8Array): Promise<void> {
        await super.create(id, path, state);
        if (id === first) this.rename(id, "Archive/First.md");
      }
    }
    const phone = await device(served, await signIn(served.url), new Hasty());
    await until(() => laptop.paths().get(first) === "Archive/First.md");
    expect(phone.vault.paths().get(first)).toBe("Archive/First.md");
  });

  it("stops while a note waits to load, and syncs it no more", async () => {
    const served = await startServer();
    let load: () => void = () => undefined;
    const loaded = new Promise<void>((resolve) => {
      load = resolve;
    });
    let asked = false;
    class Slow extends MemoryVault {
      override async hold(id: string): Promise<HeldDocument> {
        asked = true;
        await loaded;
        return super.hold(id);
      }
    }
    const laptop = new Slow();
    laptop.write("Ideas.md", "one");
    const { engine } = await device(served, served.token, laptop);
    await until(() => asked);
    const stopped = engine.stop();
    load();
    await stopped;
  });

  it("syncs a note's comments beside it, made on either device", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const note = laptop.write("Ideas.md", "one");
    laptop.comment(note, (threads) => {
      threads.set("t1", "on the laptop");
    });
    await device(served, served.token, laptop);
    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.threads(note).t1 === "on the laptop");

    phone.vault.comment(note, (threads) => {
      threads.set("t2", "on the phone");
    });
    await until(() => laptop.threads(note).t2 === "on the phone");
    // The note's text is its own, and the comments theirs.
    expect(laptop.text(note)).toBe("one");
  });

  it("keeps edits made offline, and sends them when the device is back", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const note = laptop.write("Ideas.md", "one");
    await device(served, served.token, laptop);
    const token = await signIn(served.url);
    const phone = await device(served, token);
    await until(() => phone.vault.text(note) === "one");

    // The phone goes offline, and both go on writing.
    await phone.engine.stop();
    phone.vault.edit(note, (text) => {
      text.insert(text.length, " two");
    });
    const offline = phone.vault.write("Offline.md", "written offline");
    laptop.edit(note, (text) => {
      text.insert(0, "zero ");
    });

    // The phone's vault and what it kept, as after the app starts again.
    await device(served, token, phone.vault, phone.store);
    await until(
      () =>
        laptop.text(note) === "zero one two" &&
        phone.vault.text(note) === "zero one two" &&
        laptop.text(offline) === "written offline",
    );
  });
});

describe("a closed channel", () => {
  it("syncs nothing more, through Hocuspocus or the relay", async () => {
    const events = {
      onSynced: () => undefined,
      onStored: () => undefined,
      onOffline: () => undefined,
    };
    const where = { server: "http://127.0.0.1:9", token: "token", workspaceId: "workspace" };
    const plain = new HocuspocusChannel(where, events);
    plain.vaults(new Map([["vault", new Y.Doc()]]));
    plain.close();
    await expect(plain.sync("note", new Y.Doc())).rejects.toThrow("Sync stopped.");

    const key = await newWorkspaceKey();
    const keys = { key: { version: 1, key }, keys: new Map([[1, key]]) };
    const relay = new RelayChannel({ ...where, ...keys }, new Y.Doc(), events, undefined);
    relay.close();
    await expect(relay.sync("note", new Y.Doc())).rejects.toThrow("Sync stopped.");
  });
});
