import { describe, expect, it } from "vitest";
import { extractLinks, noteFromJson } from "../src/index.ts";
import { databaseNote, edit, ids, richNote } from "./fixtures.ts";

describe("extractLinks", () => {
  it("finds wiki links in any block's text and the notes a note embeds, in order", () => {
    const links = extractLinks(noteFromJson(richNote()));
    expect(links).toEqual([
      {
        source: { note: ids.note, block: "p1" },
        target: { note: ids.other, heading: "Phase 1" },
        kind: "wiki",
      },
      {
        source: { note: ids.note, block: "p1" },
        target: { title: "Not written yet" },
        kind: "wiki",
      },
      {
        source: { note: ids.note, block: "b2" },
        target: { note: ids.other, block: "req-sync" },
        kind: "wiki",
      },
      { source: { note: ids.note, block: "c1" }, target: { title: "Decisions" }, kind: "wiki" },
      { source: { note: ids.note, block: "cell-3" }, target: { title: "Editor" }, kind: "wiki" },
      { source: { note: ids.note, block: "e1" }, target: { note: ids.other }, kind: "embed" },
    ]);
  });

  it("finds the rows a relation points to when given the database's schema", () => {
    const schema = noteFromJson(databaseNote()).database;
    const row = noteFromJson(
      edit(richNote(), (note) => {
        note.id = ids.row;
        note.content = [];
        note.properties = [
          { key: "blocks", value: [ids.other, ids.database] },
          { key: "blocked by", value: null },
          { key: "summary", value: [ids.other] },
        ];
      }),
    );
    expect(extractLinks(row, schema)).toEqual([
      { source: { note: ids.row }, target: { note: ids.other }, kind: "relation" },
      { source: { note: ids.row }, target: { note: ids.database }, kind: "relation" },
    ]);
    expect(extractLinks(row)).toEqual([]);
  });
});
