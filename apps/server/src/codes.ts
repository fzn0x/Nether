// Signing in by email (ADR 0033). Someone names their address; if it has
// an account, the server emails it a code of eight digits, which signs in
// once within 15 minutes. Asking answers the same whether or not the
// address has an account, and as fast, since the code is made and sent
// after the answer. Five wrong tries spend a code, and asking again
// replaces it. Only a code's SHA-256 is kept.
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { type Database, readBoolean, readNumber, readText } from "./db.ts";
import { emailField, emailKey, fail, limitBy } from "./http.ts";
import type { Mailer } from "./mail.ts";
import { startSession } from "./sessions.ts";

/** Minutes a code lasts. */
export const codeMinutes = 15;
/** Wrong tries that spend a code. */
export const codeTries = 5;

/** A new code: eight random digits, shown in two groups of four. */
export function newCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

function codeHash(digits: string): string {
  return createHash("sha256").update(digits).digest("hex");
}

/** The digits of a code as someone types it, with spaces or dashes between. */
function digitsOf(code: string): string | undefined {
  const digits = code.replace(/[\s-]/g, "");
  return /^\d{8}$/.test(digits) ? digits : undefined;
}

interface Ask {
  readonly email: string;
}

const askBody = {
  type: "object",
  required: ["email"],
  additionalProperties: false,
  properties: { email: emailField },
} as const;

interface Redeem {
  readonly email: string;
  readonly code: string;
}

const redeemBody = {
  type: "object",
  required: ["email", "code"],
  additionalProperties: false,
  properties: {
    email: { type: "string", minLength: 1, maxLength: 320 },
    code: { type: "string", minLength: 1, maxLength: 32 },
  },
} as const;

const wrongCode = "That code is not this address's, or has been used or has expired.";

/** Makes a code for an address that has an account, and emails it. */
async function sendCode(
  db: Database,
  mailer: Mailer,
  email: string,
  publicUrl: string | null,
): Promise<void> {
  const { rows } = await db.query("SELECT id, name, email FROM users WHERE email_key = $1", [
    emailKey(email),
  ]);
  const user = rows[0];
  if (user === undefined) return;
  const userId = readText(user, "id");
  const code = newCode();
  await db.transaction(async (tx) => {
    // One code at a time, and none kept past its time.
    await tx.query("DELETE FROM sign_in_codes WHERE user_id = $1 OR expires_at < now()", [userId]);
    await tx.query(
      `INSERT INTO sign_in_codes (id, user_id, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + $4 * interval '1 minute')`,
      [randomUUID(), userId, codeHash(code), codeMinutes],
    );
  });
  const shown = `${code.slice(0, 4)} ${code.slice(4)}`;
  await mailer.send({
    to: readText(user, "email"),
    subject: `Nether sign-in code ${shown}`,
    text: [
      `Hello ${readText(user, "name")},`,
      "",
      "Your code to sign in to Nether is",
      "",
      `    ${shown}`,
      "",
      // The web app signs in from the link (ADR 0053); the code is after #, never sent to the server's logs.
      ...(publicUrl === null
        ? []
        : [
            "or open this link:",
            "",
            `    ${publicUrl.replace(/\/+$/, "")}/sign-in#${new URLSearchParams({ email: readText(user, "email"), code }).toString()}`,
            "",
          ]),
      `It works once, within ${String(codeMinutes)} minutes. If you did not ask to sign in,`,
      "ignore this email: no one can sign in without the code.",
      "",
    ].join("\n"),
  });
}

/** The routes of signing in by email, which a server has only when it can send email. */
export function registerCodes(
  app: FastifyInstance,
  db: Database,
  mailer: Mailer,
  publicUrl: string | null = null,
): void {
  const sending = new Set<Promise<void>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled(sending);
  });

  function send(email: string, log: FastifyBaseLogger): void {
    const sent = sendCode(db, mailer, email, publicUrl)
      .catch((error: unknown) => {
        log.error({ err: error }, "Could not email a sign-in code");
      })
      .finally(() => sending.delete(sent));
    sending.add(sent);
  }

  app.post<{ Body: Ask }>(
    "/api/sign-in-codes",
    {
      schema: { body: askBody },
      onRequest: app.rateLimit({ max: 10, timeWindow: "15 minutes" }),
      // A few emails to one address, however many ask for them.
      preHandler: limitBy(app, 3, "15 minutes", (request) => emailKey((request.body as Ask).email)),
    },
    async (request, reply) => {
      send(request.body.email, request.log);
      return reply.code(202).send({
        message: "If this address has an account, a code to sign in is on its way to it.",
      });
    },
  );

  app.post<{ Body: Redeem }>(
    "/api/sign-in-codes/redeem",
    {
      schema: { body: redeemBody },
      onRequest: app.rateLimit({ max: 30, timeWindow: "5 minutes" }),
    },
    async (request, reply) => {
      const digits = digitsOf(request.body.code);
      const outcome = await db.transaction(async (tx) => {
        const { rows } = await tx.query(
          `SELECT c.id AS code_id, c.code_hash, c.tries, u.id, u.name, u.email, u.instance_admin
             FROM sign_in_codes c JOIN users u ON u.id = c.user_id
            WHERE u.email_key = $1 AND c.expires_at > now()
            FOR UPDATE OF c`,
          [emailKey(request.body.email)],
        );
        const row = rows[0];
        if (row === undefined) return undefined;
        const codeId = readText(row, "code_id");
        const matches =
          digits !== undefined &&
          timingSafeEqual(
            Buffer.from(codeHash(digits), "hex"),
            Buffer.from(readText(row, "code_hash"), "hex"),
          );
        if (!matches) {
          await (readNumber(row, "tries") + 1 >= codeTries
            ? tx.query("DELETE FROM sign_in_codes WHERE id = $1", [codeId])
            : tx.query("UPDATE sign_in_codes SET tries = tries + 1 WHERE id = $1", [codeId]));
          return undefined;
        }
        await tx.query("DELETE FROM sign_in_codes WHERE id = $1", [codeId]);
        const id = readText(row, "id");
        return {
          ...(await startSession(tx, id, request)),
          user: {
            id,
            name: readText(row, "name"),
            email: readText(row, "email"),
            instanceAdmin: readBoolean(row, "instance_admin"),
          },
        };
      });
      if (outcome === undefined) return fail(reply, 401, wrongCode);
      return reply.code(201).send(outcome);
    },
  );
}
