// What a note's menu does: a copy beside it, its full path on disk, the
// vault's folders, and its tags, read and written in its frontmatter.
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanTag,
  copyNote,
  fullPath,
  noteTags,
  setNoteTags,
  tagsOf,
  vaultFolders,
  withTags,
} from "../src/noteActions.ts";

const watching: AbortController[] = [];

afterEach(() => {
  for (const controller of watching.splice(0)) controller.abort();
});

async function openVault(files: Record<string, string>) {
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, new MemoryStore());
  await vault.open();
  const controller = new AbortController();
  watching.push(controller);
  void vault.watch(controller.signal);
  return { memory, vault };
}

describe("copyNote", () => {
  it("copies a note beside it under the next free name", async () => {
    const { memory, vault } = await openVault({
      "Projects/Plan.md": "---\ntags: [work]\n---\n\n# Plan\n",
      "Projects/Plan 2.md": "taken",
    });
    const id = vault.noteAt("Projects/Plan.md")?.id;
    if (id === undefined) throw new Error("No Plan.md");
    const copy = await copyNote(vault, id);
    expect(copy.path).toBe("Projects/Plan 3.md");
    expect(copy.id).not.toBe(id);
    expect((await memory.read("Projects/Plan 3.md")).text).toBe(
      "---\ntags: [work]\n---\n\n# Plan\n",
    );
  });
});

describe("fullPath", () => {
  it("joins the vault's folder and a note's path as the system writes paths", () => {
    expect(fullPath("C:\\Users\\Ada\\Notes", "Projects/Plan.md")).toBe(
      "C:\\Users\\Ada\\Notes\\Projects\\Plan.md",
    );
    expect(fullPath("/home/ada/Notes/", "Projects/Plan.md")).toBe(
      "/home/ada/Notes/Projects/Plan.md",
    );
  });
});

describe("vaultFolders", () => {
  it("lists every folder once, the top first, with the folders that only hold folders", () => {
    expect(vaultFolders(["Welcome.md", "a/b/c/Note.md", "a/x.png", "z/Other.md"])).toEqual([
      "",
      "a",
      "a/b",
      "a/b/c",
      "z",
    ]);
  });
});

describe("tags in frontmatter", () => {
  it("reads a list, or one string of tags, without the #", () => {
    expect(tagsOf(["work", "#home", 3])).toEqual(["work", "home"]);
    expect(tagsOf("work, #home area/project")).toEqual(["work", "home", "area/project"]);
    expect(tagsOf(undefined)).toEqual([]);
  });

  it("keeps a typed tag as frontmatter does: no #, and dashes for spaces", () => {
    expect(cleanTag("  #to read ")).toBe("to-read");
    expect(cleanTag("area/project")).toBe("area/project");
  });

  it("sets the tags under the key the note uses, and removes the key for none", () => {
    const entries = [
      { key: "status", value: "draft" },
      { key: "Tags", value: ["old"] },
    ];
    expect(withTags(entries, ["new"])).toEqual([
      { key: "status", value: "draft" },
      { key: "Tags", value: ["new"] },
    ]);
    expect(withTags(entries, [])).toEqual([{ key: "status", value: "draft" }]);
    expect(withTags([{ key: "status", value: "draft" }], ["a"])).toEqual([
      { key: "status", value: "draft" },
      { key: "tags", value: ["a"] },
    ]);
  });

  it("are read from and written to a note's file through its document", async () => {
    const { memory, vault } = await openVault({
      "Plan.md": "---\nstatus: draft\ntags: [work]\n---\n\n# Plan\n",
    });
    const id = vault.noteAt("Plan.md")?.id;
    if (id === undefined) throw new Error("No Plan.md");
    expect(await noteTags(vault, id)).toEqual(["work"]);
    await setNoteTags(vault, id, ["work", "area/project"]);
    await vi.waitFor(async () => {
      expect((await memory.read("Plan.md")).text).toBe(
        "---\nstatus: draft\ntags: [work, area/project]\n---\n\n# Plan\n",
      );
    });
  });
});
