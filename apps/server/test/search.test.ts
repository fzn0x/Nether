// Workspace search (ADR 0050): a note's text, tags and properties read from
// its Yjs state; the index kept as notes and vault documents are stored;
// queries with words, prefixes, phrases, exclusions and filters; and only
// the notes of the units an account may open, in workspaces the server can
// read.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { backfillSearch, noteContent, readSnippet, search } from "../src/search.ts";
import { storeDocument } from "../src/sync.ts";
import { type SetUp, type TestServer, bearer, setUp, startServer } from "./app.ts";

let running: TestServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

type Test = TestServer & SetUp;

async function start(): Promise<Test> {
  running = await startServer();
  return { ...running, ...(await setUp(running)) };
}

/** A note's state as the editor keeps it: blocks of text, and properties. */
function noteState(
  blocks: readonly string[],
  properties: Record<string, unknown> = {},
): Uint8Array {
  const document = new Y.Doc();
  const content = document.getXmlFragment("content");
  for (const text of blocks) {
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText(text)]);
    content.push([paragraph]);
  }
  const map = document.getMap("properties");
  for (const [key, value] of Object.entries(properties)) map.set(key, value);
  return Y.encodeStateAsUpdate(document);
}

/** A vault document's state, listing notes by ID and path. */
function vaultState(paths: Record<string, string>, from?: Uint8Array): Uint8Array {
  const document = new Y.Doc();
  if (from !== undefined) Y.applyUpdate(document, from);
  const notes = document.getMap<string>("notes");
  for (const id of [...notes.keys()]) if (!(id in paths)) notes.delete(id);
  for (const [id, path] of Object.entries(paths)) notes.set(id, path);
  return Y.encodeStateAsUpdate(document);
}

async function titles(test: Test, query: string, userId = test.userId): Promise<string[]> {
  return (await search(test.db, userId, query)).results.map((result) => result.title).sort();
}

describe("noteContent", () => {
  it("reads blocks as lines, nested ones too, and tags from the text and the property", () => {
    const document = new Y.Doc();
    const content = document.getXmlFragment("content");
    const heading = new Y.XmlElement("heading");
    heading.insert(0, [new Y.XmlText("Launch plan")]);
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    const inner = new Y.XmlElement("paragraph");
    const run = new Y.XmlText("Ship it #release/beta, not #2024");
    inner.insert(0, [run]);
    item.insert(0, [inner]);
    list.insert(0, [item]);
    content.push([heading, list]);
    run.format(0, 4, { bold: true });
    document.getMap("properties").set("tags", ["Plans", "plans"]);
    const read = noteContent(Y.encodeStateAsUpdate(document));
    expect(read.body).toBe("Launch plan\nShip it #release/beta, not #2024");
    expect(read.tags).toEqual(["Plans", "release/beta"]);
    expect(read.properties).toEqual({ tags: ["Plans", "plans"] });
  });

  it("reads a snippet's marked matches as ranges", () => {
    expect(readSnippet("a \u{E000}big\u{E001} plan, \u{E000}big\u{E001}")).toEqual({
      text: "a big plan, big",
      matches: [
        [2, 5],
        [12, 15],
      ],
    });
  });
});

describe("workspace search", () => {
  it("finds notes by words, prefixes, phrases and filters, and leaves out exclusions", async () => {
    const test = await start();
    const [plan, recipe, daily] = [randomUUID(), randomUUID(), randomUUID()];
    const store = (name: string, state: Uint8Array) =>
      storeDocument(test.db, test.workspaceId, name, state);
    await store(
      "vault",
      vaultState({
        [plan]: "Projects/Launch plan.md",
        [recipe]: "Recipes/Soup.md",
        [daily]: "Daily/Monday.md",
      }),
    );
    await store(
      plan,
      noteState(["We ship the launch in spring.", "Budget below."], {
        status: "Doing",
        tags: ["work/q2"],
      }),
    );
    await store(recipe, noteState(["Spring onions and leeks, simmered."], { status: "done" }));
    await store(daily, noteState(["Met about the launch budget. #work"]));

    expect(await titles(test, "launch")).toEqual(["Launch plan", "Monday"]);
    // The last word as it is typed, a prefix; the title weighs most.
    const ranked = await search(test.db, test.userId, "laun");
    expect(ranked.results.map((result) => result.title)).toEqual(["Launch plan", "Monday"]);
    expect(await titles(test, '"launch budget"')).toEqual(["Monday"]);
    expect(await titles(test, "spring -onions")).toEqual(["Launch plan"]);
    // A tag finds those nested under it.
    expect(await titles(test, "tag:work")).toEqual(["Launch plan", "Monday"]);
    expect(await titles(test, "#work -tag:work/q2")).toEqual(["Monday"]);
    expect(await titles(test, "path:recipes")).toEqual(["Soup"]);
    expect(await titles(test, "[status:done]")).toEqual(["Soup"]);
    expect(await titles(test, "prop:status")).toEqual(["Launch plan", "Soup"]);
    // Nothing a query could be read into: quotes and operators are words.
    expect(await titles(test, "spring' | !")).toEqual(["Launch plan", "Soup"]);

    const [first] = (await search(test.db, test.userId, "simmered")).results;
    expect(first?.path).toBe("Recipes/Soup.md");
    expect(first?.workspaceName).not.toBe("");
    const matched = first?.matches[0];
    expect(matched === undefined ? "" : first?.snippet.slice(matched[0], matched[1])).toBe(
      "simmered",
    );
  });

  it("follows moves and removals, and indexes what was stored before it", async () => {
    const test = await start();
    const note = randomUUID();
    const store = (name: string, state: Uint8Array) =>
      storeDocument(test.db, test.workspaceId, name, state);
    const first = vaultState({ [note]: "Ideas.md" });
    await store("vault", first);
    await store(note, noteState(["A lighthouse by the sea."]));
    const moved = vaultState({ [note]: "Archive/Old ideas.md" }, first);
    await store("vault", moved);
    expect((await search(test.db, test.userId, "lighthouse")).results[0]?.path).toBe(
      "Archive/Old ideas.md",
    );
    await store("vault", vaultState({}, moved));
    expect(await titles(test, "lighthouse")).toEqual([]);

    // A database from before search: emptied, then indexed again once.
    await test.db.query("DELETE FROM note_search");
    await store("vault", vaultState({ [note]: "Back.md" }, moved));
    await test.db.query("DELETE FROM note_search");
    await test.db.query("INSERT INTO search_backfill VALUES (true)");
    expect(await backfillSearch(test.db)).toBe(2);
    expect(await titles(test, "lighthouse")).toEqual(["Back"]);
    expect(await backfillSearch(test.db)).toBe(0);
  });

  it("finds only the notes of the units an account opens, and not in encrypted workspaces", async () => {
    const test = await start();
    const invited = await test.server.inject({
      method: "POST",
      url: `/api/workspaces/${test.workspaceId}/invitations`,
      headers: bearer(test.token),
      payload: { role: "member" },
    });
    const bea = (
      await test.server.inject({
        method: "POST",
        url: "/api/invitations/accept",
        payload: {
          token: invited.json<{ token: string }>().token,
          name: "Bea",
          email: "bea@example.org",
          password: "Bea's long password",
        },
      })
    ).json<{ token: string; user: { id: string } }>();
    const made = await test.server.inject({
      method: "POST",
      url: `/api/workspaces/${test.workspaceId}/teamspaces`,
      headers: bearer(test.token),
      payload: { name: "Design" },
    });
    const design = made.json<{ id: string }>().id;
    const [open, secret] = [randomUUID(), randomUUID()];
    await test.db.query(
      "INSERT INTO note_units (workspace_id, note, unit_id) VALUES ($1, $2, $3)",
      [test.workspaceId, secret, design],
    );
    const store = (name: string, state: Uint8Array) =>
      storeDocument(test.db, test.workspaceId, name, state);
    await store("vault", vaultState({ [open]: "Plans.md" }));
    await store(`vault.${design}`, vaultState({ [secret]: "Design/Logo.md" }));
    await store(open, noteState(["The brand colors."]));
    await store(secret, noteState(["The brand logo, secret."]));

    expect(await titles(test, "brand")).toEqual(["Logo", "Plans"]);
    expect(await titles(test, "brand", bea.user.id)).toEqual(["Plans"]);

    // An encrypted workspace is not searched, and named so.
    const encrypted = randomUUID();
    await test.db.query(
      "INSERT INTO workspaces (id, name, encryption) VALUES ($1, 'Diary', 'end-to-end')",
      [encrypted],
    );
    await test.db.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [encrypted, bea.user.id],
    );
    expect((await search(test.db, bea.user.id, "brand")).encrypted).toEqual(["Diary"]);

    // Through the API, signed in, limited and checked.
    const answer = await test.server.inject({
      method: "GET",
      url: "/api/search?q=brand",
      headers: bearer(bea.token),
    });
    expect(answer.statusCode).toBe(200);
    expect(answer.json<{ results: { title: string }[] }>().results.map((r) => r.title)).toEqual([
      "Plans",
    ]);
    expect(
      (await test.server.inject({ method: "GET", url: "/api/search?q=brand" })).statusCode,
    ).toBe(401);
    expect(
      (
        await test.server.inject({
          method: "GET",
          url: "/api/search?q=%20",
          headers: bearer(bea.token),
        })
      ).statusCode,
    ).toBe(400);
  });
});
