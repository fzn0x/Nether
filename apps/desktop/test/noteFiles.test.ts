// A note's files in the desktop app: the names pasted and dropped files
// get, and how a note's links find files and add new ones.
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { describe, expect, it } from "vitest";
import type { VaultMedia } from "../src/backend.ts";
import { attachmentName, noteFiles } from "../src/noteFiles.ts";

const now = new Date(2026, 9, 30, 15, 30, 5);

describe("attachmentName", () => {
  it("names a pasted image by the time, as Obsidian does", () => {
    const pasted = new File(["x"], "image.png", { type: "image/png" });
    expect(attachmentName(pasted, true, now)).toBe("Pasted image 20261030153005.png");
    const unnamed = new File(["x"], "", { type: "image/jpeg" });
    expect(attachmentName(unnamed, true, now)).toBe("Pasted image 20261030153005.jpeg");
  });

  it("keeps a dropped file's name, but the characters links and file systems cannot hold", () => {
    expect(attachmentName(new File(["x"], "image.png"), false, now)).toBe("image.png");
    expect(attachmentName(new File(["x"], "Plan [v2] #1: a|b?.PDF"), false, now)).toBe(
      "Plan -v2- -1- a-b-.PDF",
    );
    expect(attachmentName(new File(["x"], ".hidden.png"), false, now)).toBe("hidden.png");
    expect(attachmentName(new File(["x"], "..."), false, now)).toBe("Attachment 20261030153005");
  });
});

describe("noteFiles", () => {
  async function setUp(withMedia: Partial<VaultMedia> = {}) {
    const memory = new MemoryFiles({
      "Projects/Note.md": "# Note",
      "attachments/photo.png": "png",
    });
    const vault = new Vault(memory, new MemoryStore());
    await vault.open();
    const note = vault.noteAt("Projects/Note.md");
    if (note === undefined) throw new Error("The note is not in the vault.");
    const id = note.id;
    const errors: unknown[] = [];
    const media: VaultMedia = { url: (path) => `media/${path}`, ...withMedia };
    const files = noteFiles(vault, media, id, (error) => errors.push(error));
    return { vault, files, errors };
  }

  it("finds a link's file from where the note is, and gives its URL", async () => {
    const { files } = await setUp();
    expect(files.url("photo.png")).toBe("media/attachments/photo.png");
    expect(files.url("missing.png")).toBeUndefined();
  });

  it("adds a pasted file to the attachments folder and returns its shortest link", async () => {
    const { vault, files } = await setUp();
    const link = await files.attach?.(new File(["x"], "photo.png"), false);
    expect(link).toBe("photo 1.png");
    expect(vault.resolveFile("photo 1.png", "Projects/Note.md")).toBe("attachments/photo 1.png");
  });

  it("reports a file it could not add, and returns no link", async () => {
    const { files, errors } = await setUp();
    expect(await files.attach?.(new File(["x"], "notes.md"), false)).toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("opens and shows files where the app can, and reports what goes wrong", async () => {
    const opened: string[] = [];
    const { files, errors } = await setUp({
      open: (path) => {
        opened.push(path);
        return Promise.resolve();
      },
      reveal: () => Promise.reject(new Error("no file manager")),
    });
    files.open?.("photo.png");
    files.open?.("missing.png");
    files.reveal?.("photo.png");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened).toEqual(["attachments/photo.png"]);
    expect(errors).toHaveLength(1);
    const plain = await setUp();
    expect("open" in plain.files || "reveal" in plain.files).toBe(false);
  });
});
