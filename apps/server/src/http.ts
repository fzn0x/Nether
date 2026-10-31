// What the routes share: the schemas of the fields several of them take,
// and errors in the shape Fastify gives its own, so a client reads every
// error's `message` the same way.
import { STATUS_CODES } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { minimumPasswordLength } from "./passwords.ts";

/** A person's or a workspace's name: some text that is not only spaces. */
export const nameField = { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" } as const;

export const emailField = {
  type: "string",
  maxLength: 320,
  pattern: "^\\s*[^@\\s]+@[^@\\s]+\\.[^@\\s]+\\s*$",
} as const;

/** A new password. One being checked is any text, so a wrong one is only wrong. */
export const newPasswordField = {
  type: "string",
  minLength: minimumPasswordLength,
  maxLength: 1024,
} as const;

export const passwordField = { type: "string", minLength: 1, maxLength: 1024 } as const;

/** A secret token the server made, as a client sends it back. */
export const tokenField = { type: "string", minLength: 1, maxLength: 200 } as const;

export const uuidField = {
  type: "string",
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
} as const;

/** The key an email address is compared by, so one person has one account. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Answers with an error: `{ statusCode, error, message }`, as Fastify's own errors are. */
export function fail(reply: FastifyReply, statusCode: number, message: string): FastifyReply {
  return reply
    .code(statusCode)
    .send({ statusCode, error: STATUS_CODES[statusCode] ?? "Error", message });
}

/** The message of a 429, after how many seconds to try again. */
export function tooManyTries(seconds: number): string {
  return `Too many tries: try again in ${String(seconds)} seconds.`;
}

/**
 * A hook that applies a second limit to a route, by a key of its own, such
 * as the account a request names. The rate-limit plugin applies one limit
 * to a request; this checks another beside it.
 */
export function limitBy(
  app: FastifyInstance,
  max: number,
  timeWindow: string,
  key: (request: FastifyRequest) => string,
) {
  const check = app.createRateLimit({ max, timeWindow, keyGenerator: key });
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const limit = await check(request);
    if (limit.isAllowed || !limit.isExceeded) return undefined;
    return fail(
      reply.header("retry-after", String(limit.ttlInSeconds)),
      429,
      tooManyTries(limit.ttlInSeconds),
    );
  };
}
