// A note's history in the desktop app: what changed since a version, with
// long unchanged runs folded, and a version put back through the document
// an open editor shares, keeping the note as it was as a version first.
import { newBlockId } from "@nether/core";
import { documentBlocks } from "@nether/editor";
import { serializeMarkdown } from "@nether/markdown";
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { afterEach, describe, expect, it } from "vitest";
import { historyDiff, restoreVersion } from "../src/history.ts";
import { noteDocuments, whenLoaded } from "../src/noteDocuments.ts";

const watching: AbortController[] = [];

afterEach(() => {
  for (const controller of watching.splice(0)) controller.abort();
});

const lines = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `line ${String(from + index)}\n`).join("");

describe("historyDiff", () => {
  it("folds long runs of unchanged lines, keeping three on each side of a change", () => {
    const version = lines(1, 20);
    const now = lines(1, 9) + "line ten\n" + lines(11, 20);
    expect(historyDiff(version, now)).toEqual([
      { kind: "folded", count: 6 },
      { kind: "same", lines: ["line 7", "line 8", "line 9"] },
      { kind: "removed", lines: ["line 10"] },
      { kind: "added", lines: ["line ten"] },
      { kind: "same", lines: ["line 11", "line 12", "line 13"] },
      { kind: "folded", count: 7 },
    ]);
  });

  it("folds nothing that would hide a single line, and gives nothing for the same text", () => {
    expect(historyDiff(lines(1, 4), "line 0\n" + lines(1, 4))).toEqual([
      { kind: "added", lines: ["line 0"] },
      { kind: "same", lines: ["line 1", "line 2", "line 3", "line 4"] },
    ]);
    expect(historyDiff("\uFEFFsame\n", "same\n")).toEqual([]);
  });
});

describe("restoreVersion", () => {
  it("puts a version back in the open note, keeping the note as it was first", async () => {
    const memory = new MemoryFiles({ "Plan.md": "# Plan\n\nThe old way.\n" });
    const vault = new Vault(memory, new MemoryStore());
    await vault.open();
    const controller = new AbortController();
    watching.push(controller);
    void vault.watch(controller.signal);
    const id = vault.noteAt("Plan.md")?.id;
    if (id === undefined) throw new Error("No Plan.md");

    // Written once: the old text is the first version.
    await vault.write(id, "# Plan\n\nThe new way.\n", (await vault.read(id)).hash);
    const [first] = await vault.versions(id);
    const old = await vault.versionText(first?.id ?? 0);
    expect(old).toBe("# Plan\n\nThe old way.\n");

    // An editor has the note open while it is restored.
    const editor = noteDocuments(vault).open(id);
    await whenLoaded(editor.note);
    await restoreVersion(vault, id, old ?? "");
    expect((await memory.read("Plan.md")).text).toBe("# Plan\n\nThe old way.\n");
    const { state } = editor.note.snapshot;
    if (state.status !== "ready") throw new Error("Not ready");
    const content = documentBlocks(state.document, newBlockId);
    expect(serializeMarkdown({ properties: [], content }).text).toBe("# Plan\n\nThe old way.\n");
    editor.release();

    // What the note was before the restore is a version now, the latest.
    const versions = await vault.versions(id);
    expect(versions.length).toBe(2);
    expect(await vault.versionText(versions[0]?.id ?? 0)).toBe("# Plan\n\nThe new way.\n");
  });
});
