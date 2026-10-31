// Live notes (ADR 0043), through a real Nether server: a note open on two
// devices stays in step as each types, each seeing the other's caret; and a
// note just made goes live once a round has listed it.
import { afterEach, describe, expect, it } from "vitest";
import type * as Y from "yjs";
import type { LiveNote } from "../src/engine.ts";
import { MemoryVault, device, signIn, startServer, stopAll, until } from "./harness.ts";

afterEach(stopAll);

function documentOf(vault: MemoryVault, id: string): Y.Doc {
  const note = vault.notes.get(id);
  if (note === undefined) throw new Error(`No note ${id}`);
  return note.document;
}

/** The names of the others the awareness sees. */
function others(live: LiveNote): string[] {
  const mine = live.awareness.clientID;
  return [...live.awareness.getStates()]
    .filter(([client]) => client !== mine)
    .map(([, state]) => (state as { user?: { name?: string } }).user?.name ?? "");
}

describe("live notes", () => {
  it("keep a note open on two devices in step as each types, with each one's caret", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const note = laptop.write("Ideas.md", "start");
    const first = await device(served, served.token, laptop);
    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.text(note) === "start");

    const here = first.engine.live(note, documentOf(laptop, note), {
      name: "Ada",
      color: "#1d5c94",
    });
    const there = phone.engine.live(note, documentOf(phone.vault, note), {
      name: "Ada on the phone",
      color: "#2f6b1f",
    });
    await until(() => others(here).includes("Ada on the phone") && others(there).includes("Ada"));

    // Each keystroke arrives without waiting for a round.
    const sent = Date.now();
    laptop.edit(note, (text) => {
      text.insert(text.length, " and more");
    });
    await until(() => phone.vault.text(note) === "start and more");
    const took = Date.now() - sent;
    expect(took).toBeLessThan(1000);

    phone.vault.edit(note, (text) => {
      text.insert(0, "Phone: ");
    });
    await until(() => laptop.text(note) === "Phone: start and more");

    // Stopped, the note syncs in rounds again.
    here.stop();
    there.stop();
    laptop.edit(note, (text) => {
      text.insert(text.length, ".");
    });
    await until(() => phone.vault.text(note) === "Phone: start and more.");
  });

  it("goes live once a round has listed a note just made", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    const first = await device(served, served.token, laptop);
    const phone = await device(served, await signIn(served.url));
    await until(
      () => first.engine.status.state === "synced" && phone.engine.status.state === "synced",
    );

    const note = laptop.write("Fresh.md", "new");
    const here = first.engine.live(note, documentOf(laptop, note), {
      name: "Ada",
      color: "#1d5c94",
    });
    await until(() => phone.vault.text(note) === "new");
    const there = phone.engine.live(note, documentOf(phone.vault, note), {
      name: "Phone",
      color: "#2f6b1f",
    });
    await until(() => others(here).includes("Phone"));
    phone.vault.edit(note, (text) => {
      text.insert(text.length, "er");
    });
    await until(() => laptop.text(note) === "newer");
    there.stop();
    here.stop();
  });
});
