// A note's history on the server (ADR 0041): the state a store replaces is
// kept when the note's last version is ten minutes old, listed for members,
// given back as a Yjs state, and deleted once older than the admin keeps them.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { storeDocument } from "../src/sync.ts";
import { purgeVersions } from "../src/versions.ts";
import { type SetUp, type TestServer, bearer, setUp, startServer } from "./app.ts";

let running: TestServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(env: Record<string, string> = {}): Promise<TestServer & SetUp> {
  running = await startServer({ env });
  return { ...running, ...(await setUp(running)) };
}

function stateOf(text: string): Uint8Array {
  const document = new Y.Doc();
  document.getText("content").insert(0, text);
  return Y.encodeStateAsUpdate(document);
}

function textOf(state: Uint8Array): string {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document.getText("content").toJSON();
}

/** Moves every version back in time, as if kept that long ago. */
async function age(test: TestServer, minutes: number): Promise<void> {
  await test.db.query(
    "UPDATE document_versions SET created_at = created_at - make_interval(mins => $1)",
    [minutes],
  );
}

async function count(test: TestServer): Promise<number> {
  const { rows } = await test.db.query("SELECT id FROM document_versions");
  return rows.length;
}

describe("a note's versions on the server", () => {
  it("keeps the state each store replaces, ten minutes apart, and gives it to members", async () => {
    const test = await start();
    const note = randomUUID();
    const three = stateOf("three");
    const store = (state: Uint8Array) => storeDocument(test.db, test.workspaceId, note, state);
    // The first store replaces nothing; the second keeps the first.
    await store(stateOf("one"));
    await store(stateOf("two"));
    expect(await count(test)).toBe(1);
    // Within ten minutes of that version, nothing more is kept.
    await store(three);
    expect(await count(test)).toBe(1);
    await age(test, 11);
    // A store that changes nothing keeps nothing.
    await store(three);
    expect(await count(test)).toBe(1);
    await store(stateOf("four"));
    expect(await count(test)).toBe(2);
    // The vault document has no history.
    await storeDocument(test.db, test.workspaceId, "vault", stateOf("a"));
    await storeDocument(test.db, test.workspaceId, "vault", stateOf("b"));
    expect(await count(test)).toBe(2);

    const url = `/api/workspaces/${test.workspaceId}/documents/${note}/versions`;
    const listed = await test.server.inject({ method: "GET", url, headers: bearer(test.token) });
    expect(listed.statusCode).toBe(200);
    const { versions } = listed.json<{ versions: { id: string; time: string }[] }>();
    expect(versions.length).toBe(2);
    expect(Date.parse(versions[0]?.time ?? "")).toBeGreaterThan(
      Date.parse(versions[1]?.time ?? ""),
    );

    const fetch = (id: string, path = url) =>
      test.server.inject({ method: "GET", url: `${path}/${id}`, headers: bearer(test.token) });
    const latest = await fetch(versions[0]?.id ?? "");
    expect(latest.headers["content-type"]).toBe("application/octet-stream");
    expect(textOf(new Uint8Array(latest.rawPayload))).toBe("three");
    expect(textOf(new Uint8Array((await fetch(versions[1]?.id ?? "")).rawPayload))).toBe("one");

    // Another note's address, another workspace, and no session find nothing.
    const elsewhere = `/api/workspaces/${test.workspaceId}/documents/${randomUUID()}/versions`;
    expect((await fetch(versions[0]?.id ?? "", elsewhere)).statusCode).toBe(404);
    const other = `/api/workspaces/${randomUUID()}/documents/${note}/versions`;
    expect(
      (await test.server.inject({ method: "GET", url: other, headers: bearer(test.token) }))
        .statusCode,
    ).toBe(404);
    expect((await test.server.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await fetch("0")).statusCode).toBe(400);
  });

  it("deletes the versions older than the admin keeps them", async () => {
    const test = await start({ NETHER_HISTORY_DAYS: "7" });
    const note = randomUUID();
    await storeDocument(test.db, test.workspaceId, note, stateOf("one"));
    await storeDocument(test.db, test.workspaceId, note, stateOf("two"));
    expect(await purgeVersions(test.db, 7)).toBe(0);
    await age(test, 8 * 24 * 60);
    expect(await purgeVersions(test.db, 7)).toBe(1);
    expect(await count(test)).toBe(0);
  });
});
