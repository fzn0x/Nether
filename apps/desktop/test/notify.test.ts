// Mentions on their way to the server: kept on this device until sent, in
// order; kept when the server cannot be reached; dropped when it refuses.
import { MemoryStore } from "@nether/storage";
import { describe, expect, it } from "vitest";
import { type PendingMention, queueMention, sendMentions } from "../src/notify.ts";
import { ServerError } from "../src/server.ts";

const mention = (note: string): PendingMention => ({
  server: "https://nether.test",
  workspaceId: "w",
  note,
  thread: "t",
  people: ["u2"],
});

describe("mentions on their way", () => {
  it("sends those waiting in order, once each", async () => {
    const store = new MemoryStore();
    await queueMention(store, mention("a"));
    await queueMention(store, mention("b"));
    const sent: string[] = [];
    await sendMentions(store, (each) => {
      sent.push(each.note);
      return Promise.resolve();
    });
    await sendMentions(store, (each) => {
      sent.push(each.note);
      return Promise.resolve();
    });
    expect(sent).toEqual(["a", "b"]);
  });

  it("keeps them while the server cannot be reached, and drops one it refuses", async () => {
    const store = new MemoryStore();
    await queueMention(store, mention("refused"));
    await queueMention(store, mention("later"));
    await queueMention(store, mention("last"));
    const tried: string[] = [];
    await sendMentions(store, (each) => {
      tried.push(each.note);
      return Promise.reject(
        each.note === "refused"
          ? new ServerError(403, "No")
          : new ServerError(0, "The server cannot be reached."),
      );
    });
    // The refused one is dropped; the next fails for now, and the rest wait behind it.
    expect(tried).toEqual(["refused", "later"]);
    const sent: string[] = [];
    await sendMentions(store, (each) => {
      sent.push(each.note);
      return Promise.resolve();
    });
    expect(sent).toEqual(["later", "last"]);
  });
});
