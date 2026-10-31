// A database's rows: the notes in the folder beside it, and their values.
import type { NoteId } from "@nether/core";
import { describe, expect, it } from "vitest";
import {
  type Row,
  isRowOf,
  linkName,
  rowFolder,
  rowTitle,
  rowValue,
  rowsOf,
} from "../src/index.ts";

describe("rowsOf", () => {
  it("finds the notes in the folder beside the database, not in folders below it", () => {
    const notes = [
      "Projects.md",
      "Projects/Launch site.md",
      "projects/Write docs.md",
      "Projects/Launch site/Notes.md",
      "Projects/photo.png",
      "Projects 2/Other.md",
      "Projects.md.md",
      "Elsewhere/Projects/Not a row.md",
    ].map((path) => ({ path }));
    expect(rowsOf(notes, "Projects.md").map((note) => note.path)).toEqual([
      "Projects/Launch site.md",
      "projects/Write docs.md",
    ]);
    expect(isRowOf("Work/Projects/A.md", "Work/Projects.md")).toBe(true);
    expect(isRowOf("Work/Projects/A.md", "Projects.md")).toBe(false);
    expect(rowFolder("Work/Projects.md")).toBe("Work/Projects");
  });
});

describe("linkName", () => {
  it("names the note a link names, and leaves other text as it is", () => {
    expect(linkName("[[Acme]]")).toBe("Acme");
    expect(linkName("[[Clients/Acme|Acme Inc]]")).toBe("Acme");
    expect(linkName(" [[Clients/Acme.md#Contacts]] ")).toBe("Acme");
    expect(linkName("Acme")).toBe("Acme");
    expect(linkName("[[Acme]] and [[Globex]]")).toBe("[[Acme]] and [[Globex]]");
  });
});

describe("rowValue", () => {
  const row: Row = {
    id: "01929f4c-7b00-7a00-8000-000000000002" as NoteId,
    path: "Projects/Launch site.md",
    created: 1_000,
    updated: 2_000,
    properties: [
      { key: "status", value: "Doing" },
      { key: "tags", value: ["web", "launch"] },
    ],
  };

  it("reads the title and times from the file, and the rest from the frontmatter", () => {
    expect(rowTitle(row)).toBe("Launch site");
    expect(rowValue(row, "$title")).toBe("Launch site");
    expect(rowValue(row, "$created")).toBe(1_000);
    expect(rowValue(row, "$updated")).toBe(2_000);
    expect(rowValue(row, "status")).toBe("Doing");
    expect(rowValue(row, "tags")).toEqual(["web", "launch"]);
    expect(rowValue(row, "missing")).toBeUndefined();
  });
});
