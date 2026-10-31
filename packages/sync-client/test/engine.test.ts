// Two devices syncing one vault through a real Nether server, on PGlite:
// linking a vault and opening it elsewhere, edits both ways and at once,
// notes made, moved and removed, and edits made offline.
import { afterEach, describe, expect, it } from "vitest";
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
