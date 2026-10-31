// Notifications (ADR 0045): a member mentioned in a note's comments is told
// in the app, and by email when the server can send it and they have not
// turned it off. The server cannot read an encrypted workspace's comments,
// so the client that sends a comment names the people it mentions; the
// server checks that the sender may comment on the note and that each
// person may open it, and tells no one else. An encrypted workspace's
// notifications carry no text: no title, no excerpt.
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { type Database, readBoolean, readCount, readText, readTextOrNull, readTime } from "./db.ts";
import { fail, limitBy, uuidField } from "./http.ts";
import type { Mailer } from "./mail.ts";
import { accountOf, signedIn } from "./sessions.ts";
import { accessible, unitOfDocument } from "./units.ts";
import { membership } from "./workspaces.ts";

/** How many notifications a list gives at once. */
export const notificationPage = 50;
/** Days a notification is kept. */
export const notificationDays = 90;
/** The most people one comment tells. */
const mostPeople = 20;

interface Mention {
  readonly kind: "mention";
  readonly note: string;
  readonly thread?: string;
  readonly people: readonly string[];
  readonly title?: string;
  readonly excerpt?: string;
}

const mentionBody = {
  type: "object",
  required: ["kind", "note", "people"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["mention"] },
    note: uuidField,
    thread: uuidField,
    people: { type: "array", minItems: 1, maxItems: mostPeople, items: uuidField },
    title: { type: "string", minLength: 1, maxLength: 200 },
    excerpt: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

interface ListQuery {
  readonly unread?: boolean;
}

interface Read {
  readonly ids?: readonly string[];
  readonly all?: boolean;
}

const readBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    ids: { type: "array", minItems: 1, maxItems: 100, items: uuidField },
    all: { type: "boolean", enum: [true] },
  },
} as const;

interface Settings {
  readonly email: boolean;
}

const settingsBody = {
  type: "object",
  required: ["email"],
  additionalProperties: false,
  properties: { email: { type: "boolean" } },
} as const;

/** One person to tell, as the server knows them. */
interface Recipient {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailed: boolean;
}

/** The email that tells someone they were mentioned. */
export function mentionEmail(
  to: { readonly name: string; readonly email: string },
  by: string,
  workspace: string,
  title: string | undefined,
  excerpt: string | undefined,
): { to: string; subject: string; text: string } {
  const where =
    title === undefined ? `in a note in ${workspace}.` : `on “${title}” in ${workspace}:`;
  return {
    to: to.email,
    subject: `${by} mentioned you in ${workspace}`,
    text: [
      `Hello ${to.name},`,
      "",
      `${by} mentioned you ${where}`,
      ...(excerpt === undefined ? [] : ["", ...excerpt.split("\n").map((line) => `    ${line}`)]),
      "",
      "Open the note in Nether to read the comment and reply.",
      "",
      "You get this email because you were mentioned. To stop these emails, turn",
      "off emails about mentions in Nether's notifications.",
      "",
    ].join("\n"),
  };
}

/** Deletes the notifications kept longer than the server keeps them; gives how many. */
export async function purgeNotifications(db: Database): Promise<number> {
  const { rows } = await db.query(
    "DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1) RETURNING id",
    [notificationDays],
  );
  return rows.length;
}

export function registerNotifications(
  app: FastifyInstance,
  db: Database,
  mailer: Mailer | undefined,
): void {
  const account = signedIn(db);
  const sending = new Set<Promise<void>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled(sending);
  });

  /** Emails, after the answer, those mentioned who are emailed. */
  function email(
    recipients: readonly Recipient[],
    by: string,
    workspace: string,
    title: string | undefined,
    excerpt: string | undefined,
    log: FastifyBaseLogger,
  ): void {
    if (mailer === undefined) return;
    for (const recipient of recipients) {
      if (!recipient.emailed) continue;
      const sent = mailer
        .send(mentionEmail(recipient, by, workspace, title, excerpt))
        .catch((error: unknown) => {
          log.error({ err: error }, "Could not email a notification");
        })
        .finally(() => sending.delete(sent));
      sending.add(sent);
    }
  }

  app.post<{ Params: { workspace: string }; Body: Mention }>(
    "/api/workspaces/:workspace/notifications",
    {
      schema: {
        params: { type: "object", required: ["workspace"], properties: { workspace: uuidField } },
        body: mentionBody,
      },
      // A few mentions a minute, however many comments mention people.
      preHandler: [account, limitBy(app, 60, "10 minutes", (request) => accountOf(request).id)],
    },
    async (request, reply) => {
      const me = accountOf(request);
      const workspaceId = request.params.workspace.toLowerCase();
      const { note, thread, title, excerpt } = request.body;
      const member = await membership(db, me.id, workspaceId);
      if (member === undefined) return fail(reply, 404, "This account is in no such workspace.");
      if (member.encryption === "end-to-end" && (title !== undefined || excerpt !== undefined)) {
        return fail(reply, 400, "An encrypted workspace's notifications carry no text.");
      }
      const unit = await unitOfDocument(db, workspaceId, note.toLowerCase());
      const level = (await accessible(db, me.id, workspaceId)).levels.get(unit);
      if (level === undefined || level === "view") {
        return fail(reply, 403, "Only those who may comment on a note mention people in it.");
      }
      // Those who may open the note, not the sender: the rest are not told, nor is the sender.
      const people = [...new Set(request.body.people.map((id) => id.toLowerCase()))].filter(
        (id) => id !== me.id,
      );
      const recipients: Recipient[] = [];
      for (const id of people) {
        if (!(await accessible(db, id, workspaceId)).levels.has(unit)) continue;
        const { rows } = await db.query(
          "SELECT id, name, email, email_notifications FROM users WHERE id = $1",
          [id],
        );
        const row = rows[0];
        if (row === undefined) continue;
        recipients.push({
          id: readText(row, "id"),
          name: readText(row, "name"),
          email: readText(row, "email"),
          emailed: readBoolean(row, "email_notifications"),
        });
      }
      await db.transaction(async (tx) => {
        for (const recipient of recipients) {
          await tx.query(
            `INSERT INTO notifications
               (id, user_id, workspace_id, actor_id, kind, note, thread, title, excerpt)
             VALUES ($1, $2, $3, $4, 'mention', $5, $6, $7, $8)`,
            [
              randomUUID(),
              recipient.id,
              workspaceId,
              me.id,
              note.toLowerCase(),
              thread?.toLowerCase() ?? null,
              title ?? null,
              excerpt ?? null,
            ],
          );
        }
      });
      const { rows } = await db.query("SELECT name FROM workspaces WHERE id = $1", [workspaceId]);
      email(recipients, me.name, readText(rows[0], "name"), title, excerpt, request.log);
      return reply.code(201).send({ notified: recipients.map((recipient) => recipient.id) });
    },
  );

  app.get<{ Querystring: ListQuery }>(
    "/api/notifications",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { unread: { type: "boolean" } },
        },
      },
      preHandler: account,
    },
    async (request) => {
      const me = accountOf(request);
      const { rows } = await db.query(
        `SELECT n.id, n.workspace_id, w.name AS workspace_name, n.kind, n.note, n.thread,
                n.title, n.excerpt, n.actor_id, a.name AS actor_name, n.created_at, n.read_at
           FROM notifications n
           JOIN workspaces w ON w.id = n.workspace_id
           JOIN memberships m ON m.workspace_id = n.workspace_id AND m.user_id = n.user_id
           LEFT JOIN users a ON a.id = n.actor_id
          WHERE n.user_id = $1 AND ($2::boolean IS NOT TRUE OR n.read_at IS NULL)
          ORDER BY n.created_at DESC, n.id
          LIMIT $3`,
        [me.id, request.query.unread ?? false, notificationPage],
      );
      const unread = await db.query(
        `SELECT count(*) AS count FROM notifications n
           JOIN memberships m ON m.workspace_id = n.workspace_id AND m.user_id = n.user_id
          WHERE n.user_id = $1 AND n.read_at IS NULL`,
        [me.id],
      );
      return {
        notifications: rows.map((row) => {
          const actor = readTextOrNull(row, "actor_id");
          const read = row.read_at === null ? null : readTime(row, "read_at").toISOString();
          return {
            id: readText(row, "id"),
            workspace: { id: readText(row, "workspace_id"), name: readText(row, "workspace_name") },
            kind: readText(row, "kind"),
            note: readText(row, "note"),
            thread: readTextOrNull(row, "thread"),
            title: readTextOrNull(row, "title"),
            excerpt: readTextOrNull(row, "excerpt"),
            actor: actor === null ? null : { id: actor, name: readText(row, "actor_name") },
            created: readTime(row, "created_at").toISOString(),
            read,
          };
        }),
        unread: readCount(unread.rows[0], "count"),
      };
    },
  );

  app.post<{ Body: Read }>(
    "/api/notifications/read",
    { schema: { body: readBody }, preHandler: account },
    async (request, reply) => {
      const me = accountOf(request);
      const { ids, all } = request.body;
      if (all === true) {
        await db.query(
          "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL",
          [me.id],
        );
      } else if (ids !== undefined) {
        await db.query(
          `UPDATE notifications SET read_at = now()
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
          [me.id, ids.map((id) => id.toLowerCase())],
        );
      } else {
        return fail(reply, 400, "Name the notifications read, or all of them.");
      }
      return reply.code(204).send();
    },
  );

  app.get("/api/me/notification-settings", { preHandler: account }, async (request) => {
    const { rows } = await db.query("SELECT email_notifications FROM users WHERE id = $1", [
      accountOf(request).id,
    ]);
    return { email: readBoolean(rows[0], "email_notifications") };
  });

  app.put<{ Body: Settings }>(
    "/api/me/notification-settings",
    { schema: { body: settingsBody }, preHandler: account },
    async (request) => {
      await db.query("UPDATE users SET email_notifications = $2 WHERE id = $1", [
        accountOf(request).id,
        request.body.email,
      ]);
      return { email: request.body.email };
    },
  );
}
