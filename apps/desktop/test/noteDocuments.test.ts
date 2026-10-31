// A vault's open notes: one document per note, shared by whoever holds it,
// saved to its file and closed when the last holder lets go, and merged
// with the edits another app makes to the file.
import { newBlockId } from "@nether/core";
import { documentBlocks, setDocumentBlocks } from "@nether/editor";
import { parseMarkdown, serializeMarkdown } from "@nether/markdown";
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { type OpenNote, noteDocuments } from "../src/noteDocuments.ts";

const watching: AbortController[] = [];

afterEach(() => {
  for (const controller of watching.splice(0)) controller.abort();
});

async function setUp(files: Record<string, string>) {
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, new MemoryStore());
  await vault.open();
  const controller = new AbortController();
  watching.push(controller);
  void vault.watch(controller.signal);
  const id = (path: string) => {
    const note = vault.noteAt(path);
    if (note === undefined) throw new Error(`No note at ${path}.`);
    return note.id;
  };
  return { memory, vault, id, documents: noteDocuments(vault) };
}

/** Waits until `check` holds, a few seconds at most. */
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function ready(note: OpenNote) {
  await until(() => note.snapshot.state.status === "ready");
  const { state } = note.snapshot;
  if (state.status !== "ready") throw new Error("Not ready");
  return state;
}

/** The note's blocks as Markdown, as the editor's document holds them. */
function textOf(note: OpenNote): string {
  const { state } = note.snapshot;
  if (state.status !== "ready") return "";
  const content = documentBlocks(state.document, newBlockId);
  return serializeMarkdown({ properties: [], content }).text;
}

describe("noteDocuments", () => {
  it("gives everyone holding a note its one document, and saves it when the last lets go", async () => {
    const { memory, id, documents } = await setUp({ "Ideas.md": "# Ideas\n\nFirst.\n" });
    const editor = documents.open(id("Ideas.md"));
    const sync = documents.open(id("Ideas.md"));
    expect(sync.note).toBe(editor.note);
    const { document } = await ready(editor.note);

    setDocumentBlocks(document, parseMarkdown("# Ideas\n\nFirst.\n\nSecond.\n").content);
    editor.release();
    // Still held, and still open.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(documents.open(id("Ideas.md")).note).toBe(sync.note);
    sync.release();
    // The last hold: the note saves at once, without waiting for a pause.
    await until(async () => (await memory.read("Ideas.md")).text.includes("Second."));
    expect((await memory.read("Ideas.md")).text).toBe("# Ideas\n\nFirst.\n\nSecond.\n");
  });

  it("keeps a note let go and held again at once, as React does in development", async () => {
    const { id, documents } = await setUp({ "Ideas.md": "# Ideas\n" });
    const first = documents.open(id("Ideas.md"));
    first.release();
    const again = documents.open(id("Ideas.md"));
    expect(again.note).toBe(first.note);
    await ready(again.note);
    again.release();
  });

  it("opens a note again only once its last save is done, with its whole history", async () => {
    const { memory, id, documents } = await setUp({ "Ideas.md": "# Ideas\n\nFirst.\n" });
    const first = documents.open(id("Ideas.md"));
    const { document } = await ready(first.note);
    // A slow disk: the closing note's save takes a while.
    const write = memory.write.bind(memory);
    memory.write = async (path, text, base) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return write(path, text, base);
    };
    setDocumentBlocks(document, parseMarkdown("# Ideas\n\nChanged.\n").content);
    const history = Y.decodeStateVector(Y.encodeStateVector(document));
    first.release();
    // After the moment a hold is kept for, the note is closing.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = documents.open(id("Ideas.md"));
    expect(second.note).not.toBe(first.note);
    const reopened = await ready(second.note);
    expect(textOf(second.note)).toContain("Changed.");
    expect((await memory.read("Ideas.md")).text).toBe("# Ideas\n\nChanged.\n");
    // The same document, not one made again from the file, which sync would
    // take for new text beside the old.
    const kept = Y.decodeStateVector(Y.encodeStateVector(reopened.document));
    for (const [client, clock] of history) {
      expect(kept.get(client) ?? 0).toBeGreaterThanOrEqual(clock);
    }
    second.release();
  });

  it("merges another app's edit to the file into the open document", async () => {
    const { memory, id, documents } = await setUp({ "Ideas.md": "# Ideas\n\nFirst.\n" });
    const hold = documents.open(id("Ideas.md"));
    const before = await ready(hold.note);
    memory.edit("Ideas.md", "# Ideas\n\nFirst, edited elsewhere.\n");
    await until(() => textOf(hold.note).includes("edited elsewhere"));
    const after = await ready(hold.note);
    // The document stays the one the editor has; its text is read anew.
    expect(after.document).toBe(before.document);
    expect(after.version).toBeGreaterThan(before.version);
    hold.release();
  });
});
