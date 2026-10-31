// Shared pages (ADR 0042): a page shared on its own becomes a unit, keeping
// the people of the unit it sits in unless restricted, its levels following
// the page tree; guests invited to a page open it alone; and a page no
// longer shared on its own goes back where it sits.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readBytes } from "../src/db.ts";
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

function call(
  test: Test,
  method: string,
  path: string,
  token: string | undefined,
  payload?: object,
) {
  return test.server.inject({
    method: method as "GET",
    url: path.startsWith("/api/") ? path : `/api/workspaces/${test.workspaceId}${path}`,
    headers: token === undefined ? {} : bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });
}

async function accept(test: Test, token: string, name: string) {
  const accepted = await call(test, "POST", "/api/invitations/accept", undefined, {
    token,
    name,
    email: `${name.toLowerCase()}@example.org`,
    password: `${name}'s long password`,
  });
  const body = accepted.json<{ token: string; user: { id: string } }>();
  return { token: body.token, id: body.user.id };
}

async function join(test: Test, name: string) {
  const invited = await call(test, "POST", "/invitations", test.token, { role: "member" });
  return accept(test, invited.json<{ token: string }>().token, name);
}

async function levels(test: Test, token: string): Promise<Record<string, string>> {
  const shown = (await call(test, "GET", "/units", token)).json<{
    units: { id: string; level: string }[];
  }>().units;
  return Object.fromEntries(shown.map((unit) => [unit.id, unit.level]));
}

async function share(test: Test, token: string, note: string, restricted = false) {
  const made = await call(test, "POST", "/pages", token, { note, restricted });
  return { status: made.statusCode, id: made.json<{ id?: string }>().id ?? "" };
}

/** A vault document's state listing these notes and files. */
function listing(notes: Record<string, string>, files: Record<string, object> = {}): Uint8Array {
  const document = new Y.Doc();
  for (const [id, path] of Object.entries(notes)) document.getMap("notes").set(id, path);
  for (const [path, file] of Object.entries(files)) document.getMap("files").set(path, file);
  return Y.encodeStateAsUpdate(document);
}

/** A stored vault document's notes and files. */
async function listed(test: Test, name: string) {
  const { rows } = await test.db.query(
    "SELECT state FROM documents WHERE workspace_id = $1 AND name = $2",
    [test.workspaceId, name],
  );
  const document = new Y.Doc();
  if (rows[0] !== undefined) Y.applyUpdate(document, readBytes(rows[0], "state"));
  return {
    notes: Object.fromEntries(document.getMap("notes").entries()),
    files: [...document.getMap("files").keys()].sort(),
  };
}

describe("shared pages", () => {
  it("keep the people where the page sits, unless restricted to their own", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const note = randomUUID();
    const page = await share(test, test.token, note);
    expect(page.status).toBe(201);
    // The page's note is in its unit now.
    const { rows } = await test.db.query("SELECT unit_id FROM note_units WHERE note = $1", [note]);
    expect(rows[0]?.unit_id).toBe(page.id);
    expect((await share(test, test.token, note)).status).toBe(409);
    // Unrestricted, it keeps General's people at their level there.
    expect((await levels(test, bea.token))[page.id]).toBe("full");

    await call(test, "PATCH", `/pages/${page.id}`, test.token, { restricted: true });
    expect((await levels(test, bea.token))[page.id]).toBeUndefined();
    expect((await call(test, "GET", `/documents/${note}/versions`, bea.token)).statusCode).toBe(
      404,
    );
    // A restricted page keeps someone at full access.
    expect(
      (await call(test, "DELETE", `/units/${page.id}/grants/${test.userId}`, test.token))
        .statusCode,
    ).toBe(409);

    await call(test, "PUT", `/units/${page.id}/grants/${bea.id}`, test.token, { level: "view" });
    expect((await levels(test, bea.token))[page.id]).toBe("view");
    const grants = (await call(test, "GET", `/units/${page.id}/grants`, bea.token)).json<{
      restricted: boolean;
      grants: { name: string; level: string }[];
    }>();
    expect(grants.restricted).toBe(true);
    expect(grants.grants.map(({ name, level }) => [name, level])).toEqual([
      ["Ada", "full"],
      ["Bea", "view"],
    ]);
  });

  it("follow the page tree, and go back where they sit when no longer shared on their own", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const outer = randomUUID();
    const inner = randomUUID();
    const parent = await share(test, test.token, outer, true);
    await call(test, "PUT", `/units/${parent.id}/grants/${bea.id}`, test.token, { level: "edit" });
    // A page inside the shared page sits in its unit, and is shared inside it.
    await call(test, "PUT", `/notes/${inner}/unit`, test.token, { unit: parent.id });
    const child = await share(test, test.token, inner);
    expect((await levels(test, bea.token))[child.id]).toBe("edit");

    // Stopping the outer one: its notes go to General, and the inner page with them.
    expect((await call(test, "DELETE", `/pages/${parent.id}`, test.token)).statusCode).toBe(204);
    const { rows } = await test.db.query("SELECT note, unit_id FROM note_units ORDER BY note");
    expect(rows).toEqual([{ note: inner, unit_id: child.id }]);
    expect((await levels(test, bea.token))[child.id]).toBe("full");
  });

  it("list their notes where they sit before they stop being shared on their own", async () => {
    const test = await start();
    const launch = randomUUID();
    const tasks = randomUUID();
    const page = await share(test, test.token, launch);
    await storeDocument(
      test.db,
      test.workspaceId,
      `vault.${page.id}`,
      listing(
        { [launch]: "Projects/Launch.md", [tasks]: "Projects/Launch/Tasks.md" },
        { "Projects/Launch/plan.png": { hash: "a".repeat(64), blob: "a".repeat(64) } },
      ),
    );
    expect((await call(test, "DELETE", `/pages/${page.id}`, test.token)).statusCode).toBe(204);
    expect(await listed(test, "vault")).toEqual({
      notes: { [launch]: "Projects/Launch.md", [tasks]: "Projects/Launch/Tasks.md" },
      files: ["Projects/Launch/plan.png"],
    });
  });

  it("move a renamed teamspace's notes and files to its new folder in its list", async () => {
    const test = await start();
    const design = (await call(test, "POST", "/teamspaces", test.token, { name: "Design" })).json<{
      id: string;
    }>().id;
    const plan = randomUUID();
    const other = randomUUID();
    await storeDocument(
      test.db,
      test.workspaceId,
      `vault.${design}`,
      listing(
        { [plan]: "Design/Plan.md", [other]: "Designs.md" },
        { "Design/a.png": { hash: "b".repeat(64), blob: "b".repeat(64) } },
      ),
    );
    await call(test, "PATCH", `/teamspaces/${design}`, test.token, { name: "Studio" });
    expect(await listed(test, `vault.${design}`)).toEqual({
      notes: { [plan]: "Studio/Plan.md", [other]: "Designs.md" },
      files: ["Studio/a.png"],
    });
  });

  it("are shared only by those with full access where the page is", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const design = (await call(test, "POST", "/teamspaces", test.token, { name: "Design" })).json<{
      id: string;
    }>().id;
    await call(test, "PUT", `/units/${design}/grants/${bea.id}`, test.token, { level: "edit" });
    const note = randomUUID();
    await call(test, "PUT", `/notes/${note}/unit`, test.token, { unit: design });
    expect((await share(test, bea.token, note)).status).toBe(403);
    expect((await share(test, test.token, note)).status).toBe(201);
  });

  it("take guests invited to them, who open them alone", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const note = randomUUID();
    const page = await share(test, test.token, note, true);
    const design = (await call(test, "POST", "/teamspaces", test.token, { name: "Design" })).json<{
      id: string;
    }>().id;
    // A guest comes with a page, at a level, from someone with full access to it.
    expect(
      (await call(test, "POST", "/invitations", test.token, { role: "guest" })).statusCode,
    ).toBe(400);
    expect(
      (
        await call(test, "POST", "/invitations", test.token, {
          role: "member",
          unit: page.id,
          level: "view",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(test, "POST", "/invitations", test.token, {
          role: "guest",
          unit: design,
          level: "view",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(test, "POST", "/invitations", bea.token, {
          role: "guest",
          unit: page.id,
          level: "view",
        })
      ).statusCode,
    ).toBe(404);
    const invited = await call(test, "POST", "/invitations", test.token, {
      role: "guest",
      unit: page.id,
      level: "comment",
    });
    expect(invited.statusCode).toBe(201);
    const token = invited.json<{ token: string }>().token;
    const looked = await call(test, "POST", "/api/invitations/lookup", undefined, { token });
    expect(looked.json()).toMatchObject({
      role: "guest",
      page: { unit: page.id, level: "comment" },
    });
    const waiting = (await call(test, "GET", `/units/${page.id}/grants`, test.token)).json<{
      invitations: { level: string }[];
    }>();
    expect(waiting.invitations.map((item) => item.level)).toEqual(["comment"]);

    const gus = await accept(test, token, "Gus");
    expect(await levels(test, gus.token)).toEqual({ [page.id]: "comment" });
    const listed = await call(test, "GET", "/members", gus.token);
    expect(listed.statusCode).toBe(403);

    // Given edit, the guest makes a page inside it: a new note, which leaves nothing.
    await call(test, "PUT", `/units/${page.id}/grants/${gus.id}`, test.token, { level: "edit" });
    const fresh = randomUUID();
    expect(
      (await call(test, "PUT", `/notes/${fresh}/unit`, gus.token, { unit: page.id })).statusCode,
    ).toBe(200);
    // A note of General's the server has stored is not new: the guest takes none of it.
    const stored = randomUUID();
    await storeDocument(test.db, test.workspaceId, stored, new Uint8Array([0, 0]));
    expect(
      (await call(test, "PUT", `/notes/${stored}/unit`, gus.token, { unit: page.id })).statusCode,
    ).toBe(403);
  });
});
