// The app's side of databases: rows from the vault and the link index, a
// row's value written to its file, and new databases and rows.
import type { DatabaseSchema } from "@nether/core";
import { readDatabase } from "@nether/database";
import { LinkGraph, indexNote } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";
import { MemoryFiles, MemoryStore, Vault } from "@nether/storage";
import { describe, expect, it } from "vitest";
import {
  createDatabase,
  createRow,
  databaseRows,
  freePath,
  linkToNote,
  resolveLink,
  setNoteProperty,
  databaseNotes,
  shortLink,
  syncBacklinks,
  syncBase,
  updateNoteProperty,
} from "../src/databases.ts";
import { pageMoves } from "../src/renameNote.ts";

async function setUp(files: Record<string, string>) {
  const memory = new MemoryFiles(files);
  const vault = new Vault(memory, new MemoryStore());
  await vault.open();
  const graph = new LinkGraph();
  for (const note of vault.notes()) {
    const parsed = parseMarkdown(files[note.path] ?? "");
    graph.set(note.id, note.path, indexNote(parsed, parsed.writtenIds));
  }
  const text = async (path: string) => (await memory.read(path)).text;
  return { memory, vault, graph, text };
}

describe("databases in the vault", () => {
  it("makes a database with a table, and rows in the folder beside it", async () => {
    const { vault, text } = await setUp({ "Work/Untitled database.md": "taken" });
    const database = await createDatabase(vault, "Work", "Untitled database");
    expect(database.path).toBe("Work/Untitled database 2.md");
    const schema = readDatabase(
      parseMarkdown(await text(database.path)).properties[0]?.value,
      () => undefined,
    );
    expect(schema.views.map((view) => [view.name, view.layout])).toEqual([["Table", "table"]]);
    const row = await createRow(vault, database.path, "Untitled");
    expect(row.path).toBe("Work/Untitled database 2/Untitled.md");
    expect((await createRow(vault, database.path, "Untitled")).path).toBe(
      "Work/Untitled database 2/Untitled 2.md",
    );
    expect(freePath(vault, "", "Fresh")).toBe("Fresh.md");
  });

  it("reads a database's rows with the properties the link index read", async () => {
    const { vault, graph } = await setUp({
      "Projects.md": "---\ndatabase:\n  properties: []\n  views: []\n---\n",
      "Projects/Launch.md": "---\nstatus: Doing\n---\nText\n",
      "Projects/Launch/Notes.md": "A page of the row\n",
      "Other.md": "Not a row\n",
    });
    const rows = databaseRows(vault.notes(), graph, "Projects.md");
    expect(rows.map((row) => [row.path, row.properties])).toEqual([
      ["Projects/Launch.md", [{ key: "status", value: "Doing" }]],
    ]);
    expect(rows[0]?.updated).toBe(vault.noteAt("Projects/Launch.md")?.modified);
  });

  it("writes a row's value into its frontmatter, changing nothing else", async () => {
    const { vault, text } = await setUp({
      "Projects/Launch.md":
        "---\n# Kept as written\nstatus: Doing   # here too\nowner: Ada\n---\nThe *text* stays.\n",
      "Projects/Plain.md": "No frontmatter yet.\n",
    });
    const launch = vault.noteAt("Projects/Launch.md")?.id;
    const plain = vault.noteAt("Projects/Plain.md")?.id;
    if (launch === undefined || plain === undefined) throw new Error("The notes are missing.");
    await setNoteProperty(vault, launch, "status", "Done");
    await setNoteProperty(vault, launch, "points", 3);
    await setNoteProperty(vault, launch, "owner", null);
    expect(await text("Projects/Launch.md")).toBe(
      "---\n# Kept as written\nstatus: Done # here too\nowner:\npoints: 3\n---\nThe *text* stays.\n",
    );
    await setNoteProperty(vault, plain, "tags", ["a", "b"]);
    expect(await text("Projects/Plain.md")).toBe(
      "---\ntags:\n  - a\n  - b\n---\nNo frontmatter yet.\n",
    );
  });

  it("writes again over a change it had not seen, and refuses a frontmatter it cannot read", async () => {
    const { memory, vault, text } = await setUp({
      "A.md": "---\nstatus: Doing\n---\n",
      "B.md": "---\nstatus: [unclosed\n---\n",
    });
    const a = vault.noteAt("A.md")?.id;
    const b = vault.noteAt("B.md")?.id;
    if (a === undefined || b === undefined) throw new Error("The notes are missing.");
    // Another app writes after the vault last read the note.
    memory.edit("A.md", "---\nstatus: Doing\nowner: Ada\n---\n");
    await setNoteProperty(vault, a, "status", "Done");
    expect(await text("A.md")).toBe("---\nstatus: Done\nowner: Ada\n---\n");
    await expect(setNoteProperty(vault, b, "status", "Done")).rejects.toThrow();
  });

  it("names a note by a link from anywhere, and finds the note a link names", async () => {
    const { vault, graph } = await setUp({ "Clients/Acme.md": "Acme\n", "Index.md": "" });
    const acme = vault.noteAt("Clients/Acme.md")?.id;
    if (acme === undefined) throw new Error("The note is missing.");
    expect(linkToNote(graph)(acme)).toBe("[[Clients/Acme]]");
    expect(resolveLink(graph, "Index.md")("[[Acme]]")).toBe(acme);
    expect(resolveLink(graph, "Index.md")("[[Clients/Acme|the client]]")).toBe(acme);
    expect(resolveLink(graph, "Index.md")("[[Nobody]]")).toBeUndefined();
  });
});

describe("the Obsidian base beside a database", () => {
  const schemaOf = (views: unknown[]) =>
    readDatabase(
      {
        properties: [
          { key: "status", type: "select", options: [] },
          { key: "due", type: "date" },
        ],
        views,
      },
      () => undefined,
    );
  const table = { name: "All", layout: "table", visible: ["status", "due"] };

  it("writes the base, then writes nothing while nothing changes", async () => {
    const { memory, vault, text } = await setUp({ "Projects.md": "" });
    const saved: DatabaseSchema[] = [];
    const schema = schemaOf([table]);
    await syncBase(vault, "Projects.md", schema, (next) => saved.push(next));
    expect(await text("Projects.base")).toContain("  - type: table\n    name: All\n");
    const hash = (await memory.read("Projects.base")).hash;
    expect(await vault.readData("bases")).toEqual({ "Projects.md": hash });
    const modified = vault.fileInfo("Projects.base")?.modified;
    await syncBase(vault, "Projects.md", schema, (next) => saved.push(next));
    expect(vault.fileInfo("Projects.base")?.modified).toBe(modified);
    expect(saved).toEqual([]);
  });

  it("brings back what Obsidian changed, keeping what is Obsidian's", async () => {
    const { memory, vault, text } = await setUp({ "Projects.md": "" });
    const schema = schemaOf([table]);
    await syncBase(vault, "Projects.md", schema, () => undefined);
    const edited = `${(await text("Projects.base")).replace("      - status\n", "")}  - type: map\n    name: Places\n`;
    memory.edit(
      "Projects.base",
      edited.replace("    name: All\n", "    name: All\n    limit: 5\n"),
    );
    const saved: DatabaseSchema[] = [];
    await syncBase(vault, "Projects.md", schema, (next) => saved.push(next));
    expect(saved.map((next) => next.views.map((view) => view.visible))).toEqual([[["due"]]]);
    const base = await text("Projects.base");
    expect(base).toContain("    limit: 5\n");
    expect(base).toContain("  - type: map\n    name: Places\n");
    // Written again from the schema, so Nether knows it as its own.
    expect(await vault.readData("bases")).toEqual({
      "Projects.md": (await memory.read("Projects.base")).hash,
    });
  });

  it("writes the base again when the schema changes in Nether, without reading it back", async () => {
    const { vault, text } = await setUp({ "Projects.md": "" });
    await syncBase(vault, "Projects.md", schemaOf([table]), () => undefined);
    const saved: DatabaseSchema[] = [];
    await syncBase(
      vault,
      "Projects.md",
      schemaOf([table, { name: "Board", layout: "board", groupBy: "status", visible: [] }]),
      (next) => saved.push(next),
    );
    expect(saved).toEqual([]);
    expect(await text("Projects.base")).toContain("  - type: kanban\n    name: Board\n");
  });

  it("moves a database's base with it", async () => {
    const { vault } = await setUp({
      "Projects.md": "",
      "Projects.base": "views: []\n",
      "Plain.md": "",
    });
    expect(pageMoves(vault, "Projects.md", "Work.md")).toEqual([
      { from: "Projects.md", to: "Work.md" },
      { from: "Projects.base", to: "Work.base" },
    ]);
    expect(pageMoves(vault, "Plain.md", "Other.md")).toEqual([
      { from: "Plain.md", to: "Other.md" },
    ]);
  });
});

describe("relations both ways", () => {
  const files = {
    "Projects.md": "---\ndatabase:\n  properties: []\n  views: []\n---\n",
    "Clients.md": "---\ndatabase:\n  properties: []\n  views: []\n---\n",
    "Projects/Launch.md": "---\nclient: []\n---\n",
    "Clients/Acme.md": '---\nprojects:\n  - "[[Old]]"\n---\nAcme\'s notes.\n',
    "Clients/Globex.md": "",
    "Elsewhere/Launch.md": "Another note of the same name\n",
  };

  it("adds a link back to the rows a relation now finds, and takes it from those it no longer does", async () => {
    const { vault, graph, text } = await setUp(files);
    const launch = vault.noteAt("Projects/Launch.md");
    if (launch === undefined) throw new Error("The row is missing.");
    await syncBacklinks(vault, graph, launch, [], ["[[Acme]]", "[[Clients/Globex]]"], "projects");
    // The shortest link that finds the row from each, a path where another note has its name.
    expect(await text("Clients/Acme.md")).toBe(
      '---\nprojects:\n  - "[[Old]]"\n  - "[[Projects/Launch]]"\n---\nAcme\'s notes.\n',
    );
    expect(await text("Clients/Globex.md")).toBe(
      '---\nprojects:\n  - "[[Projects/Launch]]"\n---\n',
    );
    // Again, nothing changes; a link written another way finds the same row.
    await syncBacklinks(
      vault,
      graph,
      launch,
      ["[[Acme]]"],
      ["[[Clients/Acme|Acme Inc]]"],
      "projects",
    );
    expect(await text("Clients/Acme.md")).toContain('  - "[[Projects/Launch]]"\n---');
    // Taken away: Globex loses its link back, and Acme keeps what else it has.
    await syncBacklinks(vault, graph, launch, ["[[Acme]]", "[[Globex]]"], ["[[Acme]]"], "projects");
    expect(await text("Clients/Globex.md")).toBe("---\nprojects: []\n---\n");
    await syncBacklinks(vault, graph, launch, ["[[Acme]]"], [], "projects");
    expect(await text("Clients/Acme.md")).toBe(
      '---\nprojects:\n  - "[[Old]]"\n---\nAcme\'s notes.\n',
    );
  });

  it("changes a property from its value in the file, and leaves the file when nothing changes", async () => {
    const { vault, text } = await setUp(files);
    const acme = vault.noteAt("Clients/Acme.md")?.id;
    if (acme === undefined) throw new Error("The row is missing.");
    await updateNoteProperty(vault, acme, "projects", () => undefined);
    expect(await text("Clients/Acme.md")).toBe(files["Clients/Acme.md"]);
    await updateNoteProperty(vault, acme, "count", (current) => (current === undefined ? 1 : null));
    expect(await text("Clients/Acme.md")).toContain("count: 1\n");
  });

  it("lists the vault's databases, and links a note by its shortest link", async () => {
    const { vault, graph } = await setUp(files);
    expect(databaseNotes(graph).map((note) => note.path)).toEqual(["Clients.md", "Projects.md"]);
    expect(shortLink(vault, "Clients/Acme.md", "Projects/Launch.md")).toBe("[[Acme]]");
    expect(shortLink(vault, "Projects/Launch.md", "Clients/Acme.md")).toBe("[[Projects/Launch]]");
  });
});
