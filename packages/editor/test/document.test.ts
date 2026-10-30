// @vitest-environment jsdom
// A note's Yjs document: blocks in and out unchanged, and blocks written in
// as small edits, so changes made to two copies of a note merge, even two
// changes to one paragraph.
import type { BlockId, ContentBlock } from "@nether/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { documentBlocks, isEmptyDocument, setDocumentBlocks } from "../src/document.ts";

const newId = () => "new" as BlockId;
const paragraph = (id: string, text: string): ContentBlock => ({
  id: id as BlockId,
  type: "paragraph",
  content: [{ type: "text", text }],
});

const note: ContentBlock[] = [
  {
    id: "h" as BlockId,
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Title" }],
  },
  paragraph("a", "Alpha line"),
  {
    id: "p" as BlockId,
    type: "paragraph",
    content: [
      { type: "text", text: "soft\nbreak and " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "wikiLink", target: { title: "Other" } },
    ],
  },
  {
    id: "l" as BlockId,
    type: "bulletListItem",
    content: [{ type: "text", text: "item" }],
    children: [
      { id: "n" as BlockId, type: "bulletListItem", content: [{ type: "text", text: "nested" }] },
    ],
  },
  { id: "m" as BlockId, type: "math", text: "x^2" },
  paragraph("z", "Last"),
];

/** Two copies of a document that start alike. */
function pair(blocks: readonly ContentBlock[]): [Y.Doc, Y.Doc] {
  const first = new Y.Doc();
  setDocumentBlocks(first, blocks);
  const second = new Y.Doc();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  return [first, second];
}

/** Sends each copy the other's changes. */
function exchange(first: Y.Doc, second: Y.Doc): void {
  const toSecond = Y.encodeStateAsUpdate(first, Y.encodeStateVector(second));
  const toFirst = Y.encodeStateAsUpdate(second, Y.encodeStateVector(first));
  Y.applyUpdate(second, toSecond);
  Y.applyUpdate(first, toFirst);
}

describe("a note's document", () => {
  it("holds a note's blocks and gives them back the same", () => {
    const document = new Y.Doc();
    expect(isEmptyDocument(document)).toBe(true);
    expect(documentBlocks(document, newId)).toEqual([]);
    setDocumentBlocks(document, note);
    expect(isEmptyDocument(document)).toBe(false);
    expect(documentBlocks(document, newId)).toEqual(note);
  });

  it("changes only what differs, under the origin given", () => {
    const document = new Y.Doc();
    setDocumentBlocks(document, note);
    const origins: unknown[] = [];
    let size = 0;
    document.on("update", (update: Uint8Array, origin: unknown) => {
      origins.push(origin);
      size += update.length;
    });
    const edited = note.map((block) => (block.id === "a" ? paragraph("a", "Alpha line!") : block));
    setDocumentBlocks(document, edited, "file");
    expect(documentBlocks(document, newId)).toEqual(edited);
    expect(origins).toEqual(["file"]);
    // One character, not the note again.
    expect(size).toBeLessThan(40);
    setDocumentBlocks(document, edited, "file");
    expect(origins).toHaveLength(1);
  });

  it("merges changes made to two copies of a note", () => {
    const [mine, theirs] = pair(note);
    setDocumentBlocks(
      mine,
      note.map((block) => (block.id === "a" ? paragraph("a", "Alpha, mine") : block)),
    );
    setDocumentBlocks(theirs, [
      ...note.filter((block) => block.id !== "z"),
      paragraph("t", "Theirs"),
    ]);
    exchange(mine, theirs);
    const merged = documentBlocks(mine, newId);
    expect(documentBlocks(theirs, newId)).toEqual(merged);
    expect(merged.map((block) => block.id)).toEqual(["h", "a", "p", "l", "m", "t"]);
    expect(merged[1]).toEqual(paragraph("a", "Alpha, mine"));
  });

  it("merges two changes to one paragraph, character by character", () => {
    const [mine, theirs] = pair([paragraph("a", "middle")]);
    setDocumentBlocks(mine, [paragraph("a", "start middle")]);
    setDocumentBlocks(theirs, [paragraph("a", "middle end")]);
    exchange(mine, theirs);
    expect(documentBlocks(mine, newId)).toEqual([paragraph("a", "start middle end")]);
  });
});
