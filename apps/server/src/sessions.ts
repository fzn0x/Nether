// Sessions (ADR 0032). Signing in gives a client a token, which it sends
// back as `Authorization: Bearer <token>`. The server keeps only the
// token's SHA-256, so its database cannot sign anyone in. A session ends
// when its client signs out, after 30 days unused, or 90 days after it
// began, whichever comes first.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type Database,
  type Queryable,
  readBoolean,
  readText,
  readTextOrNull,
  readTime,
} from "./db.ts";
import { emailKey, fail, limitBy, newPasswordField, passwordField, uuidField } from "./http.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";

/** Days a session lasts unused. */
export const sessionIdleDays = 30;
/** Days a session lasts however much it is used. */
export const sessionLifetimeDays = 90;
/** How recent a sign-in counts as signing in again, for an account without a password. */
const freshMinutes = 10;

/** A new secret: 32 random bytes, as base64url. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** How a token is kept: its SHA-256, as hex. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Who a request is from, by its session. */
export interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly instanceAdmin: boolean;
  readonly sessionId: string;
  readonly signedInAt: Date;
}

export interface NewSession {
  readonly token: string;
  readonly expiresAt: string;
}

/** Starts a session for a user, as signing in does. */
export async function startSession(
  db: Queryable,
  userId: string,
  request: FastifyRequest,
): Promise<NewSession> {
  const token = newToken();
  const client = (request.headers["user-agent"] ?? "").slice(0, 200);
  const { rows } = await db.query(
    `INSERT INTO sessions (id, user_id, token_hash, client, expires_at)
     VALUES ($1, $2, $3, $4, now() + $5 * interval '1 day')
     RETURNING expires_at`,
    [randomUUID(), userId, tokenHash(token), client, sessionLifetimeDays],
  );
  return { token, expiresAt: readTime(rows[0], "expires_at").toISOString() };
}

/** The token in an `Authorization: Bearer` header. */
export function bearerToken(header: string | undefined): string | undefined {
  return /^Bearer +(\S+) *$/i.exec(header ?? "")?.[1];
}

/** The account a token signs in, while its session lasts. */
export async function sessionAccount(db: Database, token: string): Promise<Account | undefined> {
  const { rows } = await db.query(
    `SELECT s.id AS session_id, s.created_at, s.used_at,
            u.id, u.name, u.email, u.instance_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND s.used_at > now() - $2 * interval '1 day'`,
    [tokenHash(token), sessionIdleDays],
  );
  const row = rows[0];
  if (row === undefined) return undefined;
  const sessionId = readText(row, "session_id");
  // Marked used every few minutes, not on every request.
  if (readTime(row, "used_at").getTime() < Date.now() - 5 * 60_000) {
    await db.query("UPDATE sessions SET used_at = now() WHERE id = $1", [sessionId]);
  }
  return {
    id: readText(row, "id"),
    name: readText(row, "name"),
    email: readText(row, "email"),
    instanceAdmin: readBoolean(row, "instance_admin"),
    sessionId,
    signedInAt: readTime(row, "created_at"),
  };
}

const accounts = new WeakMap<FastifyRequest, Account>();

/** A route's check that its request is signed in; it answers 401 otherwise. */
export function signedIn(db: Database) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request.headers.authorization);
    const account = token === undefined ? undefined : await sessionAccount(db, token);
    if (account === undefined) {
      return fail(reply.header("www-authenticate", "Bearer"), 401, "Sign in first.");
    }
    accounts.set(request, account);
    return undefined;
  };
}

/** The account of a request a `signedIn` check let through. */
export function accountOf(request: FastifyRequest): Account {
  const account = accounts.get(request);
  if (account === undefined) throw new Error("This route has no signedIn check.");
  return account;
}

let decoy: Promise<string> | undefined;

/** A hash no password matches, to check against when an address has no account. */
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(newToken());
  return decoy;
}

/**
 * Whether the person at a session has just proven who they are again: with
 * the account's password, or, for an account without one, by signing in
 * within the last few minutes.
 */
async function signedInAgain(
  db: Database,
  account: Account,
  password: string | undefined,
): Promise<boolean> {
  const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [account.id]);
  const hash = readTextOrNull(rows[0], "password_hash");
  if (hash === null) return account.signedInAt.getTime() > Date.now() - freshMinutes * 60_000;
  return password !== undefined && (await verifyPassword(password, hash));
}

interface SignIn {
  readonly email: string;
  readonly password: string;
}

const signInBody = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: { email: { type: "string", minLength: 1, maxLength: 320 }, password: passwordField },
} as const;

interface Revoke {
  readonly password?: string;
  readonly session?: string;
}

const revokeBody = {
  type: "object",
  additionalProperties: false,
  properties: { password: passwordField, session: uuidField },
} as const;

interface PasswordChange {
  readonly current?: string;
  readonly password: string;
}

const passwordBody = {
  type: "object",
  required: ["password"],
  additionalProperties: false,
  properties: { current: passwordField, password: newPasswordField },
} as const;

const wrongPassword = "That password is not this account's.";

/** The routes of signing in and out, of one's sessions, and of one's account. */
export function registerSessions(app: FastifyInstance, db: Database): void {
  const account = signedIn(db);

  app.post<{ Body: SignIn }>(
    "/api/sessions",
    {
      schema: { body: signInBody },
      // Per address, before the body is read; then per account, so many
      // addresses cannot guess one password together.
      onRequest: app.rateLimit({ max: 30, timeWindow: "5 minutes" }),
      preHandler: limitBy(app, 10, "15 minutes", (request) =>
        emailKey((request.body as SignIn).email),
      ),
    },
    async (request, reply) => {
      const { rows } = await db.query(
        "SELECT id, name, email, instance_admin, password_hash FROM users WHERE email_key = $1",
        [emailKey(request.body.email)],
      );
      const row = rows[0];
      const hash = row === undefined ? null : readTextOrNull(row, "password_hash");
      // An address without an account takes as long as a wrong password,
      // so the time an answer takes does not tell which addresses have one.
      const matches = await verifyPassword(request.body.password, hash ?? (await decoyHash()));
      if (row === undefined || hash === null || !matches) {
        return fail(reply, 401, "That email address and password do not match an account.");
      }
      const id = readText(row, "id");
      const session = await startSession(db, id, request);
      return reply.code(201).send({
        ...session,
        user: {
          id,
          name: readText(row, "name"),
          email: readText(row, "email"),
          instanceAdmin: readBoolean(row, "instance_admin"),
        },
      });
    },
  );

  app.get("/api/sessions", { preHandler: account }, async (request) => {
    const me = accountOf(request);
    const { rows } = await db.query(
      `SELECT id, client, created_at, used_at FROM sessions
        WHERE user_id = $1 AND expires_at > now() AND used_at > now() - $2 * interval '1 day'
        ORDER BY created_at`,
      [me.id, sessionIdleDays],
    );
    return {
      sessions: rows.map((row) => ({
        id: readText(row, "id"),
        client: readText(row, "client"),
        createdAt: readTime(row, "created_at").toISOString(),
        usedAt: readTime(row, "used_at").toISOString(),
        current: readText(row, "id") === me.sessionId,
      })),
    };
  });

  // Signing out.
  app.delete("/api/sessions/current", { preHandler: account }, async (request, reply) => {
    await db.query("DELETE FROM sessions WHERE id = $1", [accountOf(request).sessionId]);
    return reply.code(204).send();
  });

  // Ending another session, or every other one, after signing in again.
  app.post<{ Body: Revoke }>(
    "/api/sessions/revoke",
    {
      schema: { body: revokeBody },
      preHandler: [account, app.rateLimit({ max: 10, timeWindow: "15 minutes" })],
    },
    async (request, reply) => {
      const me = accountOf(request);
      if (!(await signedInAgain(db, me, request.body.password))) {
        return fail(reply, 403, wrongPassword);
      }
      const { session } = request.body;
      if (session === undefined) {
        await db.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [
          me.id,
          me.sessionId,
        ]);
        return reply.code(204).send();
      }
      const { rows } = await db.query(
        "DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id",
        [session.toLowerCase(), me.id],
      );
      if (rows.length === 0) return fail(reply, 404, "This account has no such session.");
      return reply.code(204).send();
    },
  );

  app.get("/api/me", { preHandler: account }, async (request) => {
    const me = accountOf(request);
    const { rows } = await db.query(
      `SELECT w.id, w.name, w.encryption, m.role
         FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = $1 ORDER BY w.created_at, w.name`,
      [me.id],
    );
    return {
      user: { id: me.id, name: me.name, email: me.email, instanceAdmin: me.instanceAdmin },
      workspaces: rows.map((row) => ({
        id: readText(row, "id"),
        name: readText(row, "name"),
        role: readText(row, "role"),
        encryption: readText(row, "encryption"),
      })),
    };
  });

  // A new password ends every other session, which the old one may have begun.
  app.put<{ Body: PasswordChange }>(
    "/api/me/password",
    {
      schema: { body: passwordBody },
      preHandler: [account, app.rateLimit({ max: 10, timeWindow: "15 minutes" })],
    },
    async (request, reply) => {
      const me = accountOf(request);
      if (!(await signedInAgain(db, me, request.body.current))) {
        return fail(reply, 403, wrongPassword);
      }
      const hash = await hashPassword(request.body.password);
      await db.transaction(async (tx) => {
        await tx.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, me.id]);
        await tx.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [
          me.id,
          me.sessionId,
        ]);
      });
      return reply.code(204).send();
    },
  );
}
