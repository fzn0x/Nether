// The app's side of databases: rows from the vault and the link index, a
// row's value written to its file, and new databases and rows.
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
} from "../src/databases.ts";

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
