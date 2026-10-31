// Each note's comments' document: shared by whoever holds it, kept in the
// vault's index beside the note's own document, never in its file, and
// heard of when it changes here, so it syncs.
import type { NoteId } from "@nether/core";
import { MemoryFiles, MemoryStore, Vault, commentsDocument } from "@nether/storage";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { noteComments } from "../src/noteComments.ts";

async function setUp() {
  const memory = new MemoryFiles({ "Ideas.md": "# Ideas\n" });
  const store = new MemoryStore();
  const vault = new Vault(memory, store);
  await vault.open();
  const note = vault.noteAt("Ideas.md");
  if (note === undefined) throw new Error("No note at Ideas.md.");
  return { memory, store, vault, id: note.id, comments: noteComments(vault) };
}

/** Waits until `check` holds, a few seconds at most. */
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The threads the index keeps of a note's comments. */
async function stored(store: MemoryStore, id: NoteId): Promise<Record<string, unknown>> {
  const document = new Y.Doc();
  for (const update of (await store.document(commentsDocument(id))).updates) {
    Y.applyUpdate(document, update.data);
  }
  return document.getMap("threads").toJSON();
}

describe("noteComments", () => {
  it("shares one document among the note's holders", async () => {
    const { id, comments } = await setUp();
    const panel = await comments.hold(id);
    const sync = await comments.hold(id);
    expect(sync.document).toBe(panel.document);
    panel.release();
    sync.release();
  });

  it("keeps comments in the index, not the note's file, and opens them again from it", async () => {
    const { memory, store, id, comments } = await setUp();
    const held = await comments.hold(id);
    held.document.getMap("threads").set("t1", "a comment");
    held.release();
    await until(async () => (await stored(store, id)).t1 === "a comment");
    expect((await memory.read("Ideas.md")).text).toBe("# Ideas\n");

    const again = await comments.hold(id);
    expect(again.document).not.toBe(held.document);
    expect(again.document.getMap("threads").get("t1")).toBe("a comment");
    again.release();
  });

  it("tells of changes made here, not of those sync brings", async () => {
    const { id, comments } = await setUp();
    const heard: NoteId[] = [];
    const stop = comments.subscribe((note) => heard.push(note));
    const held = await comments.hold(id);
    held.document.getMap("threads").set("t1", "made here");
    expect(heard).toEqual([id]);

    const elsewhere = new Y.Doc();
    elsewhere.getMap("threads").set("t2", "made elsewhere");
    Y.applyUpdate(held.document, Y.encodeStateAsUpdate(elsewhere), "provider");
    expect(heard).toEqual([id]);
    expect(held.document.getMap("threads").get("t2")).toBe("made elsewhere");
    stop();
    held.release();
  });
});
