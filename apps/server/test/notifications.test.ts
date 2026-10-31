// Notifications (ADR 0045): a mention tells those who may open the note,
// in the app and by email, and no one else; only those who may comment
// mention; an encrypted workspace's notifications carry no text; emails
// can be turned off; and notifications are kept 90 days.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { purgeNotifications } from "../src/notifications.ts";
import { type SetUp, type TestServer, TestMailer, bearer, setUp, startServer } from "./app.ts";

let running: TestServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

type Test = TestServer & SetUp & { mailer: TestMailer };

async function start(): Promise<Test> {
  const mailer = new TestMailer();
  running = await startServer({ mailer });
  return { ...running, ...(await setUp(running)), mailer };
}

function call(
  test: Test,
  method: string,
  path: string,
  token: string | undefined,
  payload?: object,
  workspace = test.workspaceId,
) {
  return test.server.inject({
    method: method as "GET",
    url: path.startsWith("/api/") ? path : `/api/workspaces/${workspace}${path}`,
    headers: token === undefined ? {} : bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });
}

async function join(test: Test, name: string) {
  const invited = await call(test, "POST", "/invitations", test.token, { role: "member" });
  const accepted = await call(test, "POST", "/api/invitations/accept", undefined, {
    token: invited.json<{ token: string }>().token,
    name,
    email: `${name.toLowerCase()}@example.org`,
    password: `${name}'s long password`,
  });
  const body = accepted.json<{ token: string; user: { id: string } }>();
  return { token: body.token, id: body.user.id };
}

/** A teamspace holding a new note, with people at levels; gives the note. */
async function noteIn(test: Test, grants: Record<string, string>): Promise<string> {
  const made = await call(test, "POST", "/teamspaces", test.token, { name: "Design" });
  const unit = made.json<{ id: string }>().id;
  for (const [user, level] of Object.entries(grants)) {
    await call(test, "PUT", `/units/${unit}/grants/${user}`, test.token, { level });
  }
  const note = randomUUID();
  await call(test, "PUT", `/notes/${note}/unit`, test.token, { unit });
  return note;
}

interface Listed {
  readonly notifications: {
    readonly id: string;
    readonly workspace: { readonly name: string };
    readonly note: string;
    readonly title: string | null;
    readonly excerpt: string | null;
    readonly actor: { readonly name: string } | null;
    readonly read: string | null;
  }[];
  readonly unread: number;
}

async function listed(test: Test, token: string, unread = false): Promise<Listed> {
  const url = unread ? "/api/notifications?unread=true" : "/api/notifications";
  return (await call(test, "GET", url, token)).json<Listed>();
}

describe("notifications", () => {
  it("tells those mentioned who may open the note, in the app and by email", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const cal = await join(test, "Cal");
    const note = await noteIn(test, { [bea.id]: "view" });
    const mentioned = await call(test, "POST", "/notifications", test.token, {
      kind: "mention",
      note,
      thread: randomUUID(),
      people: [bea.id, cal.id, test.userId],
      title: "Roadmap",
      excerpt: "@Bea, is this right?",
    });
    expect(mentioned.statusCode).toBe(201);
    // Not Cal, outside the teamspace, nor Ada, who wrote it.
    expect(mentioned.json()).toEqual({ notified: [bea.id] });

    const beas = await listed(test, bea.token);
    expect(beas.unread).toBe(1);
    expect(beas.notifications).toMatchObject([
      {
        workspace: { name: "Team" },
        note,
        title: "Roadmap",
        excerpt: "@Bea, is this right?",
        actor: { name: "Ada" },
        read: null,
      },
    ]);
    expect((await listed(test, cal.token)).notifications).toEqual([]);

    const message = await test.mailer.next();
    expect(message.to).toBe("bea@example.org");
    expect(message.subject).toBe("Ada mentioned you in Team");
    expect(message.text).toContain("Ada mentioned you on “Roadmap” in Team:");
    expect(message.text).toContain("    @Bea, is this right?");
    expect(test.mailer.sent).toHaveLength(1);

    const read = await call(test, "POST", "/api/notifications/read", bea.token, {
      ids: [beas.notifications[0]?.id],
    });
    expect(read.statusCode).toBe(204);
    expect((await listed(test, bea.token)).unread).toBe(0);
    expect((await listed(test, bea.token, true)).notifications).toEqual([]);
    expect((await listed(test, bea.token)).notifications[0]?.read).not.toBeNull();
  });

  it("lets only those who may comment mention, and only members of the workspace", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const note = await noteIn(test, { [bea.id]: "view" });
    const mention = (token: string) =>
      call(test, "POST", "/notifications", token, { kind: "mention", note, people: [test.userId] });
    expect((await mention(bea.token)).statusCode).toBe(403);

    const other = await test.server.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: bearer(test.token),
      payload: { name: "Elsewhere" },
    });
    const elsewhere = other.json<{ id: string }>().id;
    const outside = await call(
      test,
      "POST",
      "/notifications",
      bea.token,
      { kind: "mention", note, people: [test.userId] },
      elsewhere,
    );
    expect(outside.statusCode).toBe(404);
    expect((await listed(test, test.token)).notifications).toEqual([]);
  });

  it("carries no text in an encrypted workspace", async () => {
    const test = await start();
    await call(test, "PUT", "/api/me/keys", test.token, {
      publicKey: Buffer.alloc(32, 1).toString("base64"),
      recoveryBox: Buffer.alloc(73, 2).toString("base64"),
    });
    const made = await test.server.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: bearer(test.token),
      payload: {
        name: "Secret",
        encryption: "end-to-end",
        sealedKey: Buffer.alloc(80, 3).toString("base64"),
      },
    });
    const secret = made.json<{ id: string }>().id;
    const invited = await call(
      test,
      "POST",
      "/invitations",
      test.token,
      { role: "member" },
      secret,
    );
    const accepted = await call(test, "POST", "/api/invitations/accept", undefined, {
      token: invited.json<{ token: string }>().token,
      name: "Bea",
      email: "bea@example.org",
      password: "Bea's long password",
    });
    const bea = accepted.json<{ token: string; user: { id: string } }>();
    const note = randomUUID();
    const mention = (extra: object) =>
      call(
        test,
        "POST",
        "/notifications",
        test.token,
        { kind: "mention", note, people: [bea.user.id], ...extra },
        secret,
      );
    expect((await mention({ title: "Plan" })).statusCode).toBe(400);
    expect((await mention({ excerpt: "the secret" })).statusCode).toBe(400);
    expect((await mention({})).statusCode).toBe(201);
    const message = await test.mailer.next();
    expect(message.text).toContain("Ada mentioned you in a note in Secret.");
    expect((await listed(test, bea.token)).notifications).toMatchObject([
      { title: null, excerpt: null, workspace: { name: "Secret" } },
    ]);
  });

  it("stops emailing someone who turns it off, and tells them in the app still", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const note = await noteIn(test, { [bea.id]: "edit" });
    expect((await call(test, "GET", "/api/me/notification-settings", bea.token)).json()).toEqual({
      email: true,
    });
    const off = await call(test, "PUT", "/api/me/notification-settings", bea.token, {
      email: false,
    });
    expect(off.json()).toEqual({ email: false });
    await call(test, "POST", "/notifications", test.token, {
      kind: "mention",
      note,
      people: [bea.id],
    });
    expect((await listed(test, bea.token)).unread).toBe(1);
    await call(test, "POST", "/api/notifications/read", bea.token, { all: true });
    expect((await listed(test, bea.token)).unread).toBe(0);
    expect(test.mailer.sent).toEqual([]);
  });

  it("keeps notifications 90 days, and shows none of a workspace one has left", async () => {
    const test = await start();
    const bea = await join(test, "Bea");
    const note = await noteIn(test, { [bea.id]: "edit" });
    await call(test, "POST", "/notifications", test.token, {
      kind: "mention",
      note,
      people: [bea.id],
    });
    await call(test, "POST", "/notifications", test.token, {
      kind: "mention",
      note,
      people: [bea.id],
    });
    expect((await listed(test, bea.token)).notifications).toHaveLength(2);
    await test.db.query(
      "UPDATE notifications SET created_at = now() - interval '91 days' WHERE id = (SELECT id FROM notifications LIMIT 1)",
    );
    expect(await purgeNotifications(test.db)).toBe(1);
    expect((await listed(test, bea.token)).notifications).toHaveLength(1);

    await test.db.query("DELETE FROM memberships WHERE user_id = $1", [bea.id]);
    expect(await listed(test, bea.token)).toEqual({ notifications: [], unread: 0 });
  });
});
