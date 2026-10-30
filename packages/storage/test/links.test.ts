// Which file a link names: the rules Obsidian follows, so a vault's links
// find the same files in both apps.
import { describe, expect, it } from "vitest";
import { LinkIndex, MemoryFiles, MemoryStore, Vault, normalizeLink } from "../src/index.ts";

const vaultPaths = [
  "Welcome.md",
  "photo.png",
  "Projects/photo.png",
  "Projects/Plans/Roadmap.md",
  "Projects/Plans/chart.png",
  "Archive/2024/chart.png",
  "Archive/old.png",
  "attachments/Diagram 1.svg",
];

describe("normalizeLink", () => {
  it("works out . and .., and refuses links out of the vault or to nothing", () => {
    expect(normalizeLink("a/./b/../c.png")).toBe("a/c.png");
    expect(normalizeLink("/a//b.png")).toBe("a/b.png");
    expect(normalizeLink("../a.png")).toBeUndefined();
    expect(normalizeLink("./")).toBeUndefined();
  });
});

describe("LinkIndex.resolve", () => {
  const index = new LinkIndex(vaultPaths);

  it("finds a file beside the note first, then from the vault's folder", () => {
    expect(index.resolve("photo.png", "Projects/Note.md")).toBe("Projects/photo.png");
    expect(index.resolve("photo.png", "Welcome.md")).toBe("photo.png");
    expect(index.resolve("photo.png", "Other/Note.md")).toBe("photo.png");
    expect(index.resolve("../photo.png", "Projects/Note.md")).toBe("photo.png");
    expect(index.resolve("Plans/chart.png", "Projects/Note.md")).toBe("Projects/Plans/chart.png");
  });

  it("finds a file by the end of its path, the nearest to the note first", () => {
    expect(index.resolve("chart.png", "Projects/Plans/Note.md")).toBe("Projects/Plans/chart.png");
    expect(index.resolve("chart.png", "Archive/2024/Note.md")).toBe("Archive/2024/chart.png");
    // Nothing near: the shorter path, then the first in file explorer order.
    expect(index.resolve("chart.png", "Welcome.md")).toBe("Archive/2024/chart.png");
    expect(index.resolve("2024/chart.png", "Welcome.md")).toBe("Archive/2024/chart.png");
    expect(index.resolve("old.png", "Welcome.md")).toBe("Archive/old.png");
  });

  it("ignores case and spaces around the link", () => {
    expect(index.resolve(" ATTACHMENTS/diagram 1.SVG ", "Welcome.md")).toBe(
      "attachments/Diagram 1.svg",
    );
    expect(index.resolve("diagram 1.svg", "Welcome.md")).toBe("attachments/Diagram 1.svg");
  });

  it("reads a link that starts with / from the vault's folder only", () => {
    expect(index.resolve("/photo.png", "Projects/Note.md")).toBe("photo.png");
    expect(index.resolve("/chart.png", "Projects/Plans/Note.md")).toBeUndefined();
  });

  it("finds nothing for a missing file or a link out of the vault", () => {
    expect(index.resolve("missing.png", "Welcome.md")).toBeUndefined();
    expect(index.resolve("../../photo.png", "Projects/Note.md")).toBeUndefined();
    expect(index.resolve("", "Welcome.md")).toBeUndefined();
    // A path that only ends like the link, not at a folder's edge.
    expect(index.resolve("ld.png", "Welcome.md")).toBeUndefined();
  });

  it("writes the shortest link that finds a file again", () => {
    expect(index.linkTo("attachments/Diagram 1.svg", "Welcome.md")).toBe("Diagram 1.svg");
    // Another photo.png is nearer the note, so the link needs the path.
    expect(index.linkTo("photo.png", "Projects/Note.md")).toBe("photo.png");
    expect(index.linkTo("Projects/photo.png", "Welcome.md")).toBe("Projects/photo.png");
  });
});

describe("Vault attachments and links", () => {
  async function openVault(files: Record<string, string>) {
    const memory = new MemoryFiles(files);
    const vault = new Vault(memory, new MemoryStore());
    await vault.open();
    return { memory, vault };
  }

  it("adds a file under a free name and finds it by its link at once", async () => {
    const { memory, vault } = await openVault({ "Note.md": "x", "attachments/a.png": "old" });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const path = await vault.attach("attachments/a.png", bytes);
    expect(path).toBe("attachments/a 1.png");
    expect(memory.bytes(path)).toEqual(bytes);
    expect(new TextDecoder().decode(memory.bytes("attachments/a.png"))).toBe("old");
    expect(vault.resolveFile("a 1.png", "Note.md")).toBe(path);
    expect(vault.linkTo(path, "Note.md")).toBe("a 1.png");
    // An attachment is not a note.
    expect(vault.notes().map((note) => note.path)).toEqual(["Note.md"]);
    const read = await memory.read(path);
    expect(read).toMatchObject({ binary: true, size: 4 });
    expect(memory.bytes("missing.png")).toBeUndefined();
  });

  it("refuses to attach a note", async () => {
    const { vault } = await openVault({});
    await expect(vault.attach("x.md", new Uint8Array())).rejects.toThrow(/Markdown/);
  });

  it("finds files another app adds, moves and removes", async () => {
    const { memory, vault } = await openVault({ "Note.md": "x" });
    expect(vault.resolveFile("b.png", "Note.md")).toBeUndefined();
    memory.edit("pics/b.png", "b");
    await vault.apply([{ op: "create", path: "pics/b.png", isDir: false }]);
    expect(vault.resolveFile("b.png", "Note.md")).toBe("pics/b.png");
    memory.edit("pics/b.png", undefined);
    await vault.apply([{ op: "remove", path: "pics/b.png", isDir: false }]);
    expect(vault.resolveFile("b.png", "Note.md")).toBeUndefined();
  });
});
