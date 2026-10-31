// First-run setup (ADR 0031): while the server has no account, it makes the
// first, the instance's admin, with a first workspace the admin owns. Only
// someone with the setup code may: the server writes a new one to its log
// each time it starts without an account, so whoever reaches a new server
// first cannot claim it unless they can read its log.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "./db.ts";
import { hashPassword, minimumPasswordLength } from "./passwords.ts";

/** Whether the server still waits for its first account. */
export async function setupNeeded(db: Database): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM users LIMIT 1");
  return rows.length === 0;
}

/** A new setup code: 20 letters and digits that read aloud clearly, in groups of five. */
export function newSetupCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  const code = [...bytes].map((byte) => alphabet[byte % alphabet.length] ?? "A").join("");
  return code.match(/.{5}/g)?.join("-") ?? code;
}

function sameCode(given: string, code: string): boolean {
  // The same length to compare in constant time, whatever was given.
  const digest = (text: string) =>
    createHash("sha256").update(text.replace(/[\s-]/g, "").toUpperCase()).digest();
  return timingSafeEqual(digest(given), digest(code));
}

/** The lock setup takes, so two attempts at once make one admin. */
const setupLock = 7_446_872_102;

const setupBody = {
  type: "object",
  required: ["code", "name", "email", "password", "workspace"],
  additionalProperties: false,
  properties: {
    code: { type: "string", minLength: 1, maxLength: 64 },
    name: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" },
    email: { type: "string", maxLength: 320, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
    password: { type: "string", minLength: minimumPasswordLength, maxLength: 1024 },
    workspace: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" },
  },
} as const;

interface SetupBody {
  readonly code: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly workspace: string;
}

/**
 * The setup routes: `GET /api/setup` says whether setup is needed, and
 * `POST /api/setup` makes the admin and the first workspace. `code` is the
 * setup code the server logged, or undefined when it started set up.
 */
export function registerSetup(app: FastifyInstance, db: Database, code: string | undefined): void {
  app.get("/api/setup", async () => ({ needed: await setupNeeded(db) }));

  app.post<{ Body: SetupBody }>(
    "/api/setup",
    { schema: { body: setupBody } },
    async (request, reply) => {
      const body = request.body;
      if (code === undefined || !sameCode(body.code, code)) {
        return reply
          .code(403)
          .send({ error: "That is not the setup code the server wrote to its log." });
      }
      // Hashed before the lock, which a slow hash would hold.
      const passwordHash = await hashPassword(body.password);
      const made = await db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock($1)", [setupLock]);
        const { rows } = await tx.query("SELECT 1 FROM users LIMIT 1");
        if (rows.length > 0) return undefined;
        const user = { id: randomUUID(), name: body.name.trim(), email: body.email.trim() };
        const workspace = { id: randomUUID(), name: body.workspace.trim() };
        await tx.query(
          "INSERT INTO users (id, email, email_key, name, password_hash, instance_admin) VALUES ($1, $2, $3, $4, $5, true)",
          [user.id, user.email, user.email.toLowerCase(), user.name, passwordHash],
        );
        await tx.query("INSERT INTO workspaces (id, name) VALUES ($1, $2)", [
          workspace.id,
          workspace.name,
        ]);
        await tx.query(
          "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
          [workspace.id, user.id],
        );
        return { user, workspace };
      });
      if (made === undefined) {
        return reply.code(409).send({ error: "The server is set up already." });
      }
      request.log.info(
        { user: made.user.id },
        "Set up: the admin account and the first workspace are made",
      );
      return reply.code(201).send(made);
    },
  );
}
