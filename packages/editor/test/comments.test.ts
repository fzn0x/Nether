// A note's comments: threads on ranges of its text, each with its comments
// in order, resolved and reopened, edited and deleted, and merged when two
// people comment at once.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type CommentAnchor,
  deleteComment,
  editComment,
  observeThreads,
  readThreads,
  reopenThread,
  reply,
  resolveThread,
  startThread,
} from "../src/comments.ts";

const ada = { id: "a", name: "Ada" };
const bea = { id: "b", name: "Bea" };
const anchor: CommentAnchor = {
  start: new Uint8Array([1, 2]),
  end: new Uint8Array([3, 4]),
  block: "intro",
  quote: "the plan",
};

/** Two documents brought in step, as sync does. */
function exchange(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe("comments", () => {
  it("starts a thread on a range, with its first comment, and replies in order", () => {
    const document = new Y.Doc();
    const id = startThread(document, anchor, ada, "Is this right?", 1000);
    reply(document, id, bea, "Yes.", 2000);
    const [thread] = readThreads(document);
    expect(thread).toMatchObject({ id, anchor, created: 1000, resolved: undefined });
    expect(thread?.comments.map((comment) => [comment.author.name, comment.body])).toEqual([
      ["Ada", "Is this right?"],
      ["Bea", "Yes."],
    ]);
    expect(reply(document, "gone", bea, "Hello?")).toBeUndefined();
  });

  it("lists threads the oldest first", () => {
    const document = new Y.Doc();
    const later = startThread(document, anchor, ada, "second", 2000);
    const earlier = startThread(document, anchor, ada, "first", 1000);
    expect(readThreads(document).map((thread) => thread.id)).toEqual([earlier, later]);
  });

  it("resolves a thread and reopens it", () => {
    const document = new Y.Doc();
    const id = startThread(document, anchor, ada, "Fix this", 1000);
    resolveThread(document, id, bea, 3000);
    expect(readThreads(document)[0]?.resolved).toEqual({ by: bea, at: 3000 });
    reopenThread(document, id);
    expect(readThreads(document)[0]?.resolved).toBeUndefined();
  });

  it("edits a comment, and deletes the thread with its last one", () => {
    const document = new Y.Doc();
    const id = startThread(document, anchor, ada, "Fix this", 1000);
    const answer = reply(document, id, bea, "Done", 2000);
    if (answer === undefined) throw new Error("No reply made");
    editComment(document, id, answer, "Done, see above", 2500);
    expect(readThreads(document)[0]?.comments[1]).toMatchObject({
      body: "Done, see above",
      edited: 2500,
    });
    const first = readThreads(document)[0]?.comments[0]?.id;
    if (first === undefined) throw new Error("No first comment");
    deleteComment(document, id, first);
    expect(readThreads(document)[0]?.comments.map((comment) => comment.id)).toEqual([answer]);
    deleteComment(document, id, answer);
    expect(readThreads(document)).toEqual([]);
  });

  it("keeps both people's replies made at once, and their threads", () => {
    const laptop = new Y.Doc();
    const phone = new Y.Doc();
    const id = startThread(laptop, anchor, ada, "Thoughts?", 1000);
    exchange(laptop, phone);
    reply(laptop, id, ada, "From the laptop", 2000);
    reply(phone, id, bea, "From the phone", 2000);
    startThread(phone, anchor, bea, "Another", 3000);
    exchange(laptop, phone);
    const read = (document: Y.Doc) =>
      readThreads(document).map((thread) => thread.comments.map((comment) => comment.body));
    expect(read(laptop)).toEqual(read(phone));
    expect(read(laptop)[0]?.slice(1).sort()).toEqual(["From the laptop", "From the phone"]);
    expect(read(laptop)).toHaveLength(2);
  });

  it("tells of each change, and leaves out what it cannot read", () => {
    const document = new Y.Doc();
    let heard = 0;
    const stop = observeThreads(document, () => {
      heard += 1;
    });
    const id = startThread(document, anchor, ada, "One", 1000);
    reply(document, id, bea, "Two", 2000);
    stop();
    resolveThread(document, id, ada);
    expect(heard).toBe(2);

    document.getMap("threads").set("broken", new Y.Map());
    expect(readThreads(document).map((thread) => thread.id)).toEqual([id]);
  });
});
