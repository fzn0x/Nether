// Sync units (ADR 0042): the units each account opens, at which level;
// teamspaces made, renamed, shared and deleted; private spaces; notes moved
// between units only by those who edit both; and the documents listed and
// the versions given only for the units an account opens.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
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

async function join(test: Test, name: string, role: "member" | "guest" = "member") {
  const invited = await test.server.inject({
    method: "POST",
    url: `/api/workspaces/${test.workspaceId}/invitations`,
    headers: bearer(test.token),
    payload: { role: "member" },
  });
  const accepted = await test.server.inject({
    method: "POST",
    url: "/api/invitations/accept",
    payload: {
      token: invited.json<{ token: string }>().token,
      name,
      email: `${name.toLowerCase()}@example.org`,
      password: `${name}'s long password`,
    },
  });
  const body = accepted.json<{ token: string; user: { id: string } }>();
  if (role === "guest") {
    await test.db.query("UPDATE memberships SET role = 'guest' WHERE user_id = $1", [body.user.id]);
  }
  return { token: body.token, id: body.user.id };
}

function call(test: Test, method: string, path: string, token: string, payload?: object) {
  return test.server.inject({
    method: method as "GET",
    url: `/api/workspaces/${test.workspaceId}${path}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });
}

interface Shown {
  readonly id: string;
  readonly kind: string;
  readonly level: string;
  readonly document: string;
  readonly name?: string;
  readonly folder?: string;
}

async function units(test: Test, token: string): Promise<Shown[]> {
  return (await call(test, "GET", "/units", token)).json<{ units: Shown[] }>().units;
}

describe("units", () => {
  it("give members General, teamspaces to their members, and a private space to its own", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const gus = await join(test, "Gus", "guest");
    expect(await units(test, bea.token)).toEqual([
      { id: "general", kind: "general", level: "full", document: "vault" },
    ]);
    expect(await units(test, gus.token)).toEqual([]);

    const made = await call(test, "POST", "/teamspaces", test.token, { name: "Design" });
    expect(made.statusCode).toBe(201);
    const design = made.json<{ id: string }>().id;
    // The name is a folder's, once per workspace, and not Private's.
    for (const name of ["design", "a/b", ".hidden", "Private", "end.", "line\nbreak"]) {
      expect((await call(test, "POST", "/teamspaces", test.token, { name })).statusCode).toBe(
        name === "design" ? 409 : 400,
      );
    }
    expect(
      (await call(test, "POST", "/teamspaces", gus.token, { name: "Guests" })).statusCode,
    ).toBe(403);
    expect(await units(test, bea.token)).toHaveLength(1);
    await call(test, "PUT", `/units/${design}/grants/${bea.id}`, test.token, { level: "edit" });
    expect(await units(test, bea.token)).toContainEqual({
      id: design,
      kind: "team",
      level: "edit",
      document: `vault.${design}`,
      name: "Design",
    });
    // Guests join pages, not teamspaces.
    expect(
      (await call(test, "PUT", `/units/${design}/grants/${gus.id}`, test.token, { level: "view" }))
        .statusCode,
    ).toBe(400);
    // Only those with full access share or rename it.
    expect(
      (await call(test, "PATCH", `/teamspaces/${design}`, bea.token, { name: "Studio" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(test, "PATCH", `/teamspaces/${design}`, test.token, { name: "Studio" }))
        .statusCode,
    ).toBe(200);

    const mine = await call(test, "PUT", "/private", bea.token);
    expect(mine.json()).toMatchObject({ kind: "private", folder: "Private", level: "full" });
    const again = await call(test, "PUT", "/private", bea.token);
    expect(again.json<{ id: string }>().id).toBe(mine.json<{ id: string }>().id);
    // Nobody else opens it, owners included.
    const owners = await units(test, test.token);
    expect(owners.map((unit) => unit.kind).sort()).toEqual(["general", "team"]);
    expect((await call(test, "PUT", "/private", gus.token)).statusCode).toBe(403);
  });

  it("keep someone with full access in a teamspace, and delete one only when it is empty", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const design = (await call(test, "POST", "/teamspaces", test.token, { name: "Design" })).json<{
      id: string;
    }>().id;
    expect(
      (await call(test, "DELETE", `/units/${design}/grants/${test.userId}`, test.token)).statusCode,
    ).toBe(409);
    await call(test, "PUT", `/units/${design}/grants/${bea.id}`, test.token, { level: "full" });
    expect(
      (await call(test, "DELETE", `/units/${design}/grants/${test.userId}`, bea.token)).statusCode,
    ).toBe(204);
    expect(
      (await call(test, "DELETE", `/units/${design}/grants/${test.userId}`, bea.token)).statusCode,
    ).toBe(404);

    const note = randomUUID();
    expect(
      (await call(test, "PUT", `/notes/${note}/unit`, bea.token, { unit: design })).statusCode,
    ).toBe(200);
    expect((await call(test, "DELETE", `/teamspaces/${design}`, bea.token)).statusCode).toBe(409);
    await call(test, "PUT", `/notes/${note}/unit`, bea.token, { unit: "general" });
    expect((await call(test, "DELETE", `/teamspaces/${design}`, bea.token)).statusCode).toBe(204);
  });

  it("move a note only for those who edit where it is and where it goes", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const design = (await call(test, "POST", "/teamspaces", test.token, { name: "Design" })).json<{
      id: string;
    }>().id;
    const note = randomUUID();
    await call(test, "PUT", `/notes/${note}/unit`, test.token, { unit: design });
    // Bea opens no Design: she can neither take its note out nor put one in.
    expect(
      (await call(test, "PUT", `/notes/${note}/unit`, bea.token, { unit: "general" })).statusCode,
    ).toBe(403);
    expect(
      (await call(test, "PUT", `/notes/${randomUUID()}/unit`, bea.token, { unit: design }))
        .statusCode,
    ).toBe(403);
    // Viewing is not enough either.
    await call(test, "PUT", `/units/${design}/grants/${bea.id}`, test.token, { level: "view" });
    expect(
      (await call(test, "PUT", `/notes/${note}/unit`, bea.token, { unit: "general" })).statusCode,
    ).toBe(403);
    await call(test, "PUT", `/units/${design}/grants/${bea.id}`, test.token, { level: "edit" });
    expect(
      (await call(test, "PUT", `/notes/${note}/unit`, bea.token, { unit: "general" })).statusCode,
    ).toBe(200);
  });

  it("list the documents, and give the versions, of the units an account opens alone", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const design = (await call(test, "POST", "/teamspaces", test.token, { name: "Design" })).json<{
      id: string;
    }>().id;
    const open = randomUUID();
    const secret = randomUUID();
    await call(test, "PUT", `/notes/${secret}/unit`, test.token, { unit: design });
    const state = (text: string) => {
      const document = new Y.Doc();
      document.getText("content").insert(0, text);
      return Y.encodeStateAsUpdate(document);
    };
    for (const [name, text] of [
      ["vault", "list"],
      [`vault.${design}`, "design list"],
      [open, "one"],
      [open, "two"],
      [secret, "one"],
      [secret, "two"],
    ] as const) {
      await storeDocument(test.db, test.workspaceId, name, state(text));
    }
    const listed = async (token: string) =>
      (await call(test, "GET", "/documents", token))
        .json<{ documents: { name: string }[] }>()
        .documents.map((document) => document.name)
        .sort();
    expect(await listed(test.token)).toEqual([open, secret, "vault", `vault.${design}`].sort());
    expect(await listed(bea.token)).toEqual([open, "vault"].sort());
    expect((await call(test, "GET", `/documents/${secret}/versions`, bea.token)).statusCode).toBe(
      404,
    );
    expect((await call(test, "GET", `/documents/${open}/versions`, bea.token)).statusCode).toBe(
      200,
    );
    // No vault document keeps versions.
    const { rows } = await test.db.query("SELECT name FROM document_versions ORDER BY name");
    expect(rows.map((row) => row.name).sort()).toEqual([open, secret].sort());
  });

  it("forget a removed member's access, should they join again", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const design = (await call(test, "POST", "/teamspaces", test.token, { name: "Design" })).json<{
      id: string;
    }>().id;
    await call(test, "PUT", `/units/${design}/grants/${bea.id}`, test.token, { level: "edit" });
    expect((await call(test, "DELETE", `/members/${bea.id}`, test.token)).statusCode).toBe(204);
    const { rows } = await test.db.query("SELECT 1 FROM unit_grants WHERE user_id = $1", [bea.id]);
    expect(rows).toEqual([]);
  });

  it("are not made in an encrypted workspace yet", async () => {
    const test = await start();
    await test.db.query("UPDATE workspaces SET encryption = 'end-to-end' WHERE id = $1", [
      test.workspaceId,
    ]);
    expect(
      (await call(test, "POST", "/teamspaces", test.token, { name: "Design" })).statusCode,
    ).toBe(409);
    expect((await call(test, "PUT", "/private", test.token)).statusCode).toBe(409);
  });
});
