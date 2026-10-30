import type { BlockId } from "@nether/core";
import { describe, expect, it } from "vitest";
import { templateNote } from "../src/index.ts";

const marker = "";

function ids() {
  let count = 0;
  return { newId: () => `b${String(++count)}` as BlockId };
}

describe("templateNote", () => {
  it("is the template as it is when it has no marker", () => {
    const note = templateNote("---\ntags: [a]\n---\n# Title\n", marker, ids());
    expect(note).toEqual({
      text: "---\ntags: [a]\n---\n# Title\n",
      properties: [{ key: "tags", value: ["a"] }],
      content: [
        {
          id: "b1",
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
      ],
    });
  });

  it("puts the cursor where the marker was in a block's text, a link counting one", () => {
    const note = templateNote(`See [[A]] and **b${marker}c**.\n`, marker, ids());
    expect(note.text).toBe("See [[A]] and **bc**.\n");
    expect(note.cursor).toEqual({ block: "b1", offset: 11 });
    expect(note.content).toEqual([
      {
        id: "b1",
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "wikiLink", target: { title: "A" } },
          { type: "text", text: " and " },
          { type: "text", text: "bc", marks: [{ type: "bold" }] },
          { type: "text", text: "." },
        ],
      },
    ]);
  });

  it("keeps an empty block where the marker stood alone, though the file cannot", () => {
    const note = templateNote(`# Day\n\n${marker}\n\n## Notes\n`, marker, ids());
    expect(note.text).toBe("# Day\n\n\n\n## Notes\n");
    expect(note.content.map((block) => block.type)).toEqual(["heading", "paragraph", "heading"]);
    expect(note.content[1]).toEqual({ id: "b2", type: "paragraph", content: [] });
    expect(note.cursor).toEqual({ block: "b2", offset: 0 });
  });

  it("keeps a task whose only text was the marker a task", () => {
    const note = templateNote(`## Tasks\n- [ ] ${marker}\n`, marker, ids());
    expect(note.text).toBe("## Tasks\n- [ ] \n");
    expect(note.content[1]).toEqual({
      id: "b2",
      type: "taskListItem",
      attrs: { checked: false },
      content: [],
    });
    expect(note.cursor).toEqual({ block: "b2", offset: 0 });
  });

  it("finds the marker in a nested block, and in code", () => {
    const nested = templateNote(`- a\n  - b${marker}\n`, marker, ids());
    expect(nested.cursor).toEqual({ block: "b2", offset: 1 });
    expect(nested.content).toEqual([
      {
        id: "b1",
        type: "bulletListItem",
        content: [{ type: "text", text: "a" }],
        children: [{ id: "b2", type: "bulletListItem", content: [{ type: "text", text: "b" }] }],
      },
    ]);
    const code = templateNote(`\`\`\`js\nlet x = ${marker};\n\`\`\`\n`, marker, ids());
    expect(code.cursor).toEqual({ block: "b1", offset: 8 });
    expect(code.content[0]).toMatchObject({ type: "code", text: "let x = ;" });
  });

  it("places no cursor for a marker outside the text of blocks", () => {
    const note = templateNote(
      `---\ntitle: a${marker}\n---\n[x](https://a.test/${marker})\n`,
      marker,
      ids(),
    );
    expect(note.text).toBe("---\ntitle: a\n---\n[x](https://a.test/)\n");
    expect(note.cursor).toBeUndefined();
    expect(note.properties).toEqual([{ key: "title", value: "a" }]);
    expect(note.content[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "x", marks: [{ type: "link", href: "https://a.test/" }] }],
    });
  });
});
