// Invitations (ADR 0032): how anyone but the admin gets an account. A
// workspace's owner or admin invites someone as an admin or a member, and
// gets a secret token to send them, as a link the app makes; the server
// keeps only its SHA-256. Whoever has the token may accept it once, within
// seven days: signed in, into their account, or with a new account. An
// invitation for an email address may be accepted only by that address.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { type Database, type Queryable, readText, readTextOrNull, readTime } from "./db.ts";
import {
  emailField,
  emailKey,
  fail,
  nameField,
  newPasswordField,
  tokenField,
  uuidField,
} from "./http.ts";
import { hashPassword } from "./passwords.ts";
import { type Level, accessible } from "./units.ts";
import {
  accountOf,
  csrfMissing,
  newToken,
  requestToken,
  sessionAccount,
  signedIn,
  startSession,
  tokenHash,
} from "./sessions.ts";

/** Days an invitation can be accepted in. */
export const invitationDays = 7;

/** The roles an invitation may give: guests only with a page shared with them (ADR 0042). */
const invitedRoles = ["admin", "member", "guest"] as const;

interface Invite {
  readonly role: (typeof invitedRoles)[number];
  readonly email?: string;
  /** A shared page, to invite a guest to it alone, at `level`. */
  readonly unit?: string;
  readonly level?: Level;
}

const inviteBody = {
  type: "object",
  required: ["role"],
  additionalProperties: false,
  properties: {
    role: { type: "string", enum: invitedRoles },
    email: emailField,
    unit: uuidField,
    level: { type: "string", enum: ["full", "edit", "comment", "view"] },
  },
} as const;

interface WorkspaceParams {
  readonly workspace: string;
}

interface InvitationParams extends WorkspaceParams {
  readonly invitation: string;
}

const workspaceParams = {
  type: "object",
  required: ["workspace"],
  properties: { workspace: uuidField },
} as const;

const invitationParams = {
  type: "object",
  required: ["workspace", "invitation"],
  properties: { workspace: uuidField, invitation: uuidField },
} as const;

interface Lookup {
  readonly token: string;
}

const lookupBody = {
  type: "object",
  required: ["token"],
  additionalProperties: false,
  properties: { token: tokenField },
} as const;

interface Accept {
  readonly token: string;
  readonly name?: string;
  readonly email?: string;
  readonly password?: string;
}

const acceptBody = {
  type: "object",
  required: ["token"],
  additionalProperties: false,
  properties: {
    token: tokenField,
    name: nameField,
    email: emailField,
    password: newPasswordField,
  },
} as const;

const noInvitation = "That invitation does not exist, was accepted, or has expired.";
const otherAddress = "This invitation is for another email address.";

/** An invitation that can still be accepted. */
export interface OpenInvitation {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: string;
  /** The only address that may accept it, if it names one. */
  readonly email: string | null;
  /** The shared page it is to, and the level there, for a guest. */
  readonly unitId: string | null;
  readonly level: string | null;
}

/** The invitation a token's hash names, if it can still be accepted, locked until the transaction ends. */
export async function openInvitation(
  tx: Queryable,
  hash: string,
): Promise<OpenInvitation | undefined> {
  const { rows } = await tx.query(
    `SELECT i.id, i.workspace_id, i.role, i.email, i.unit_id, i.level, w.name AS workspace_name
       FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
      FOR UPDATE OF i`,
    [hash],
  );
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    id: readText(row, "id"),
    workspaceId: readText(row, "workspace_id"),
    workspaceName: readText(row, "workspace_name"),
    role: readText(row, "role"),
    email: readTextOrNull(row, "email"),
    unitId: readTextOrNull(row, "unit_id"),
    level: readTextOrNull(row, "level"),
  };
}

/** Whether an invitation may be accepted by an address. */
export function invites(invitation: OpenInvitation, email: string): boolean {
  return invitation.email === null || emailKey(invitation.email) === emailKey(email);
}

/**
 * Accepts an invitation into an account, and gives the workspace with the
 * role the account has there: someone in it already keeps theirs.
 */
export async function acceptInvitation(
  tx: Queryable,
  invitation: OpenInvitation,
  userId: string,
): Promise<{ id: string; name: string; role: string }> {
  await tx.query(
    `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [invitation.workspaceId, userId, invitation.role],
  );
  if (invitation.unitId !== null && invitation.level !== null) {
    await tx.query(
      `INSERT INTO unit_grants (unit_id, user_id, level) VALUES ($1, $2, $3)
       ON CONFLICT (unit_id, user_id) DO UPDATE SET level = excluded.level`,
      [invitation.unitId, userId, invitation.level],
    );
  }
  await tx.query("UPDATE invitations SET accepted_by = $1, accepted_at = now() WHERE id = $2", [
    userId,
    invitation.id,
  ]);
  const { rows } = await tx.query(
    "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
    [invitation.workspaceId, userId],
  );
  return {
    id: invitation.workspaceId,
    name: invitation.workspaceName,
    role: readText(rows[0], "role"),
  };
}

export function registerInvitations(app: FastifyInstance, db: Database): void {
  const account = signedIn(db);

  /** Why an account may not manage a workspace's invitations, or undefined if it may. */
  async function refusal(
    userId: string,
    workspaceId: string,
  ): Promise<readonly [number, string] | undefined> {
    const { rows } = await db.query(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    );
    // A workspace the account is not in is not found, so its existence stays hidden.
    if (rows.length === 0) return [404, "This account is in no such workspace."];
    if (!["owner", "admin"].includes(readText(rows[0], "role"))) {
      return [403, "Only the workspace's owners and admins may invite."];
    }
    return undefined;
  }

  app.post<{ Params: WorkspaceParams; Body: Invite }>(
    "/api/workspaces/:workspace/invitations",
    { schema: { params: workspaceParams, body: inviteBody }, preHandler: account },
    async (request, reply) => {
      const me = accountOf(request);
      const workspace = request.params.workspace.toLowerCase();
      const { role, level } = request.body;
      const unit = request.body.unit?.toLowerCase();
      if (unit === undefined) {
        if (role === "guest") {
          return fail(reply, 400, "A guest is invited to a page: name it, and their level there.");
        }
        const refused = await refusal(me.id, workspace);
        if (refused !== undefined) return fail(reply, ...refused);
      } else {
        if (role !== "guest" || level === undefined) {
          return fail(reply, 400, "An invitation to a page makes a guest, at a level there.");
        }
        // Anyone with full access to a shared page may invite someone to it.
        const { levels: found, units } = await accessible(db, me.id, workspace);
        if (found.size === 0) return fail(reply, 404, "This account is in no such workspace.");
        if (units.get(unit)?.kind !== "page" || !found.has(unit)) {
          return fail(reply, 404, "This account has no such shared page here.");
        }
        if (found.get(unit) !== "full") {
          return fail(reply, 403, "Inviting someone to a page takes full access to it.");
        }
      }
      const token = newToken();
      const id = randomUUID();
      const email = request.body.email?.trim() ?? null;
      const { rows } = await db.query(
        `INSERT INTO invitations
           (id, token_hash, workspace_id, role, email, invited_by, expires_at, unit_id, level)
         VALUES ($1, $2, $3, $4, $5, $6, now() + $7 * interval '1 day', $8, $9)
         RETURNING expires_at`,
        [
          id,
          tokenHash(token),
          workspace,
          role,
          email,
          me.id,
          invitationDays,
          unit ?? null,
          level ?? null,
        ],
      );
      return reply.code(201).send({
        id,
        token,
        role,
        email,
        ...(unit === undefined ? {} : { unit, level }),
        expiresAt: readTime(rows[0], "expires_at").toISOString(),
      });
    },
  );

  app.get<{ Params: WorkspaceParams }>(
    "/api/workspaces/:workspace/invitations",
    { schema: { params: workspaceParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const refused = await refusal(accountOf(request).id, workspace);
      if (refused !== undefined) return fail(reply, ...refused);
      const { rows } = await db.query(
        `SELECT i.id, i.role, i.email, i.created_at, i.expires_at, u.name AS invited_by
           FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.workspace_id = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
          ORDER BY i.created_at`,
        [workspace],
      );
      return {
        invitations: rows.map((row) => ({
          id: readText(row, "id"),
          role: readText(row, "role"),
          email: readTextOrNull(row, "email"),
          invitedBy: readTextOrNull(row, "invited_by"),
          createdAt: readTime(row, "created_at").toISOString(),
          expiresAt: readTime(row, "expires_at").toISOString(),
        })),
      };
    },
  );

  app.delete<{ Params: InvitationParams }>(
    "/api/workspaces/:workspace/invitations/:invitation",
    { schema: { params: invitationParams }, preHandler: account },
    async (request, reply) => {
      const workspace = request.params.workspace.toLowerCase();
      const refused = await refusal(accountOf(request).id, workspace);
      if (refused !== undefined) return fail(reply, ...refused);
      const { rows } = await db.query(
        `DELETE FROM invitations WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL
         RETURNING id`,
        [request.params.invitation.toLowerCase(), workspace],
      );
      if (rows.length === 0) return fail(reply, 404, noInvitation);
      return reply.code(204).send();
    },
  );

  // What an invitation is to, for the app to show before it is accepted.
  // The token travels in the body, not the address, which logs keep.
  app.post<{ Body: Lookup }>(
    "/api/invitations/lookup",
    {
      schema: { body: lookupBody },
      onRequest: app.rateLimit({ max: 30, timeWindow: "5 minutes" }),
    },
    async (request, reply) => {
      const { rows } = await db.query(
        `SELECT w.id AS workspace_id, w.name AS workspace_name, i.role, i.email, i.expires_at,
                i.unit_id, i.level, u.name AS invited_by
           FROM invitations i
           JOIN workspaces w ON w.id = i.workspace_id
           LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
        [tokenHash(request.body.token)],
      );
      const row = rows[0];
      if (row === undefined) return fail(reply, 404, noInvitation);
      return {
        workspace: { id: readText(row, "workspace_id"), name: readText(row, "workspace_name") },
        role: readText(row, "role"),
        email: readTextOrNull(row, "email"),
        invitedBy: readTextOrNull(row, "invited_by"),
        // A page's title stays with those who open it: the app says "a page".
        ...(row.unit_id === null
          ? {}
          : { page: { unit: readText(row, "unit_id"), level: readText(row, "level") } }),
        expiresAt: readTime(row, "expires_at").toISOString(),
      };
    },
  );

  app.post<{ Body: Accept }>(
    "/api/invitations/accept",
    {
      schema: { body: acceptBody },
      onRequest: app.rateLimit({ max: 20, timeWindow: "15 minutes" }),
    },
    async (request, reply) => {
      const { body } = request;
      // A request with a token accepts into its account; one whose token has
      // ended is refused, rather than making a second account.
      const session = requestToken(request);
      if (session === "csrf") return fail(reply, 403, csrfMissing);
      const me = session === undefined ? undefined : await sessionAccount(db, session.token);
      if (session !== undefined && me === undefined) {
        return fail(reply.header("www-authenticate", "Bearer"), 401, "Sign in again.");
      }
      if (
        me === undefined &&
        (body.name === undefined || body.email === undefined || body.password === undefined)
      ) {
        return fail(reply, 400, "Give a name, an email address and a password for the account.");
      }
      // Hashed before the transaction, which a slow hash would hold.
      const passwordHash =
        me === undefined && body.password !== undefined
          ? await hashPassword(body.password)
          : undefined;

      const outcome = await db.transaction(async (tx) => {
        const invitation = await openInvitation(tx, tokenHash(body.token));
        if (invitation === undefined) return { status: 404, message: noInvitation } as const;
        const email = me?.email ?? body.email ?? "";
        if (!invites(invitation, email)) return { status: 403, message: otherAddress } as const;

        let user = me && {
          id: me.id,
          name: me.name,
          email: me.email,
          instanceAdmin: me.instanceAdmin,
        };
        if (user === undefined) {
          const taken = await tx.query("SELECT 1 FROM users WHERE email_key = $1", [
            emailKey(email),
          ]);
          if (taken.rows.length > 0) {
            return {
              status: 409,
              message: "An account has this email address already: sign in, then accept.",
            } as const;
          }
          user = {
            id: randomUUID(),
            name: (body.name ?? "").trim(),
            email: email.trim(),
            instanceAdmin: false,
          };
          await tx.query(
            "INSERT INTO users (id, email, email_key, name, password_hash) VALUES ($1, $2, $3, $4, $5)",
            [user.id, user.email, emailKey(email), user.name, passwordHash],
          );
        }

        const workspace = await acceptInvitation(tx, invitation, user.id);
        const session = me === undefined ? await startSession(tx, user.id, request) : undefined;
        return {
          status: me === undefined ? 201 : 200,
          body: { ...session, user, workspace },
        } as const;
      });
      if ("message" in outcome) return fail(reply, outcome.status, outcome.message);
      return reply.code(outcome.status).send(outcome.body);
    },
  );
}
