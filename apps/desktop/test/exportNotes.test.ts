import { readThreads, reply, resolveThread, startThread } from "@nether/editor";
import { MemoryFiles, MemoryStore, Vault, commentsDocument } from "@nether/storage";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { exportedComments, pagePath, relativePath } from "../src/exportNotes.ts";

describe("relativePath", () => {
  it("leads from one file of the vault to another, escaping each part", () => {
    expect(relativePath("a.html", "b.html")).toBe("b.html");
    expect(relativePath("Projects/Plan.html", "attachments/My photo.png")).toBe(
      "../attachments/My%20photo.png",
    );
    expect(relativePath("a/b/c.html", "a/d/e.png")).toBe("../d/e.png");
    expect(relativePath("a/b.html", "a/b/c.html")).toBe("b/c.html");
    expect(relativePath("index.html", "Daily/2026#1.html")).toBe("Daily/2026%231.html");
  });
});

describe("exportedComments", () => {
  it("gives the notes' threads as JSON, leaving out notes with none", async () => {
    const vault = new Vault(
      new MemoryFiles({ "Plan.md": "# Plan\n", "Quiet.md": "# Quiet\n" }),
      new MemoryStore(),
    );
    await vault.open();
    const plan = vault.noteAt("Plan.md");
    const quiet = vault.noteAt("Quiet.md");
    if (plan === undefined || quiet === undefined) throw new Error("No notes");
    const comments = new Y.Doc();
    const anchor = {
      start: new Uint8Array([1]),
      end: new Uint8Array([2]),
      block: "b1",
      quote: "Plan",
    };
    const ada = { id: "u1", name: "Ada" };
    const thread = startThread(comments, anchor, ada, "Which plan?", Date.UTC(2026, 9, 31, 9));
    reply(comments, thread, { id: "u2", name: "Bea" }, "This one.", Date.UTC(2026, 9, 31, 10));
    resolveThread(comments, thread, ada, Date.UTC(2026, 9, 31, 11));
    await vault.documents.appendUpdates(commentsDocument(plan.id), [
      Y.encodeStateAsUpdate(comments),
    ]);

    const [first, second] = readThreads(comments)[0]?.comments ?? [];
    const text = await exportedComments(vault, [plan, quiet]);
    expect(JSON.parse(text ?? "")).toEqual({
      notes: [
        {
          note: plan.id,
          path: "Plan.md",
          threads: [
            {
              id: thread,
              quote: "Plan",
              block: "b1",
              created: "2026-10-31T09:00:00.000Z",
              resolved: { by: ada, at: "2026-10-31T11:00:00.000Z" },
              comments: [
                {
                  id: first?.id,
                  author: ada,
                  body: "Which plan?",
                  created: "2026-10-31T09:00:00.000Z",
                },
                {
                  id: second?.id,
                  author: { id: "u2", name: "Bea" },
                  body: "This one.",
                  created: "2026-10-31T10:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(await exportedComments(vault, [quiet])).toBeUndefined();
  });
});

describe("pagePath", () => {
  it("gives a note's page the note's path, as HTML", () => {
    expect(pagePath("Projects/Plan.md")).toBe("Projects/Plan.html");
    expect(pagePath("Notes.MD")).toBe("Notes.html");
  });
});
