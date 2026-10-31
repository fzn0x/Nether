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

  it("counts the files with a name, case aside", () => {
    expect(index.named("PHOTO.png")).toBe(2);
    expect(index.named("roadmap.md")).toBe(1);
    expect(index.named("missing.md")).toBe(0);
    expect(new LinkIndex(["a/x.md", "b/x.md", "c/X.md"]).named("x.md")).toBe(3);
  });

  it("finds a path as written before one that differs only in case", () => {
    const cased = new LinkIndex(["Notes/plan.md", "notes/Plan.md"]);
    expect(cased.resolve("notes/Plan.md", "Welcome.md")).toBe("notes/Plan.md");
    expect(cased.resolve("NOTES/PLAN.md", "Welcome.md")).toBe("Notes/plan.md");
  });

  it("writes the shortest link that finds a file again", () => {
    expect(index.linkTo("attachments/Diagram 1.svg", "Welcome.md")).toBe("Diagram 1.svg");
    // Another photo.png is nearer the note, so the link needs the path.
    expect(index.linkTo("photo.png", "Projects/Note.md")).toBe("photo.png");
    expect(index.linkTo("Projects/photo.png", "Welcome.md")).toBe("Projects/photo.png");
  });

  it("finds what an index made anew finds, as files are added and removed", () => {
    const names = ["Plan.md", "plan.md", "Ideas.md", "photo.png"];
    const folders = ["", "A/", "A/B/", "b/"];
    const all = folders.flatMap((folder) => names.map((name) => `${folder}${name}`));
    // A small generator with a seed, so a failure repeats.
    let seed = 7;
    const next = (count: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return Math.floor((seed / 2 ** 31) * count);
    };
    const index = new LinkIndex([]);
    const present: string[] = [];
    for (let step = 0; step < 400; step++) {
      const path = all[next(all.length)] ?? "";
      const at = present.indexOf(path);
      if (at === -1) {
        index.add(path);
        present.push(path);
      } else {
        index.remove(path);
        present.splice(at, 1);
      }
      const fresh = new LinkIndex(present);
      for (const link of ["Plan.md", "PLAN.md", "B/plan.md", "/Ideas.md", "photo.png"]) {
        for (const from of ["Welcome.md", "A/x.md", "A/B/y.md", "b/z.md"]) {
          expect(index.resolve(link, from), `${link} from ${from}`).toBe(fresh.resolve(link, from));
        }
      }
      expect(index.named("plan.md")).toBe(fresh.named("plan.md"));
    }
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

describe("Vault.readNotes", () => {
  it("reads many notes' files, by ID, skipping notes it does not know", async () => {
    const memory = new MemoryFiles({ "a.md": "A", "b.md": "B", "c.md": "C" });
    const vault = new Vault(memory, new MemoryStore());
    await vault.open();
    const [a, , c] = vault.notes();
    const read: string[] = [];
    await vault.readNotes(
      [a?.id, c?.id, "01929f4c-7b00-7a00-8000-000000000999"].filter(
        (id): id is NonNullable<typeof id> => id !== undefined,
      ) as never,
      (id, file) => read.push(`${vault.note(id)?.path ?? "?"}=${file.text}`),
    );
    expect(read).toEqual(["a.md=A", "c.md=C"]);
  });
});

describe("Vault data", () => {
  it("keeps JSON files of its own in .nether, out of the notes", async () => {
    const memory = new MemoryFiles({ "a.md": "A", ".nether/broken.json": "{" });
    const vault = new Vault(memory, new MemoryStore());
    await vault.open();
    expect(await vault.readData("types")).toBeUndefined();
    expect(await vault.readData("broken")).toBeUndefined();
    await vault.writeData("types", { status: "select" });
    await vault.writeData("types", { status: "text", due: "date" });
    expect(await vault.readData("types")).toEqual({ status: "text", due: "date" });
    expect(vault.notes().map((note) => note.path)).toEqual(["a.md"]);
  });

  it("lists the files of a folder of its own, which the vault's notes leave out", async () => {
    const memory = new MemoryFiles({
      "a.md": "A",
      ".nether/themes/Night.css": ":root {}",
      ".nether/themes/Day.css": ":root {}",
      ".nether/themes/.hidden/x.css": "",
      ".nether/snippets/wide.css": "",
    });
    const vault = new Vault(memory, new MemoryStore());
    await vault.open();
    expect(await vault.filesIn(".nether/themes")).toEqual([
      ".nether/themes/Day.css",
      ".nether/themes/Night.css",
    ]);
    expect(await vault.filesIn(".nether/missing")).toEqual([]);
    expect(vault.notes().map((note) => note.path)).toEqual(["a.md"]);
  });

  it("reads Obsidian's settings for the vault, and only reads them", async () => {
    const memory = new MemoryFiles({
      "a.md": "A",
      ".obsidian/daily-notes.json": '{ "folder": "Daily", "format": "YYYY/MM-DD" }',
      ".obsidian/broken.json": "{",
    });
    const vault = new Vault(memory, new MemoryStore());
    await vault.open();
    expect(await vault.readObsidianData("daily-notes")).toEqual({
      folder: "Daily",
      format: "YYYY/MM-DD",
    });
    expect(await vault.readObsidianData("templates")).toBeUndefined();
    expect(await vault.readObsidianData("broken")).toBeUndefined();
    expect(await vault.readData("daily-notes")).toBeUndefined();
  });
});
