// Sessions in a cookie, for the web app (ADR 0053). A page in a browser must
// not hold its session where its scripts can read it, so signing in from
// one, which asks with `X-Nether-Session: cookie`, sets the session's token
// in an HttpOnly cookie and takes it out of the answer. A second cookie,
// which the page can read, holds a random value the page sends back in
// `X-Nether-CSRF` with every request that changes anything: another site
// can make the browser send the cookies, but cannot read that one to send
// it back. Bearer tokens stay as they were, for the desktop app and scripts.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const sessionCookie = "nether_session";
export const csrfCookie = "nether_csrf";
export const csrfHeader = "x-nether-csrf";
const askHeader = "x-nether-session";

/** The routes that sign in, whose answers carry a session's token. */
export const signInRoutes: ReadonlySet<string> = new Set([
  "/api/setup",
  "/api/sessions",
  "/api/sign-in-codes/redeem",
  "/api/oidc/redeem",
  "/api/invitations/accept",
]);

/** A Cookie header's cookies, by name. */
export function readCookies(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === "") continue;
    try {
      if (!cookies.has(name)) cookies.set(name, decodeURIComponent(value));
    } catch {
      // A value that is not encoded as it should be is left out.
    }
  }
  return cookies;
}

/** Whether a request signing in asks for its session in a cookie. */
export function wantsCookie(request: FastifyRequest): boolean {
  return request.headers[askHeader] === "cookie";
}

/** Whether a request came over HTTPS, or to this machine, where cookies may be Secure. */
function secure(request: FastifyRequest): boolean {
  return (
    request.protocol === "https" || ["localhost", "127.0.0.1", "[::1]"].includes(request.hostname)
  );
}

function cookie(name: string, value: string, options: string[]): string {
  return [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Strict", ...options].join(
    "; ",
  );
}

/** Sets a session's cookies on an answer: its token, unseen by the page, and a CSRF value the page reads. */
export function setSessionCookies(
  reply: FastifyReply,
  request: FastifyRequest,
  token: string,
  expiresAt: string,
): void {
  const expires = `Expires=${new Date(expiresAt).toUTCString()}`;
  const flags = secure(request) ? ["Secure"] : [];
  reply.header("set-cookie", [
    cookie(sessionCookie, token, ["HttpOnly", expires, ...flags]),
    cookie(csrfCookie, randomBytes(24).toString("base64url"), [expires, ...flags]),
  ]);
}

/** Takes a session's cookies off, as signing out does. */
export function clearSessionCookies(reply: FastifyReply): void {
  const gone = "Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  reply.header("set-cookie", [
    cookie(sessionCookie, "", ["HttpOnly", gone]),
    cookie(csrfCookie, "", [gone]),
  ]);
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The methods that change nothing, which need no CSRF value. */
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The session token a request's cookie gives, if any: for a request that
 * changes something, only with the CSRF cookie's value sent back in its
 * header. Gives "csrf" when that is missing or wrong.
 */
export function cookieToken(
  request: FastifyRequest,
): { readonly token: string } | "csrf" | undefined {
  const cookies = readCookies(request.headers.cookie);
  const token = cookies.get(sessionCookie);
  if (token === undefined || token === "") return undefined;
  if (safeMethods.has(request.method)) return { token };
  const sent = request.headers[csrfHeader];
  const expected = cookies.get(csrfCookie) ?? "";
  if (typeof sent !== "string" || expected === "" || !same(sent, expected)) return "csrf";
  return { token };
}

/**
 * The session token a WebSocket's cookie gives: only from a page of this
 * server, as its Origin says, for a socket another site's page opens would
 * carry the cookie too, and sockets have no CSRF value.
 */
export function socketCookieToken(headers: Headers): string | undefined {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (origin === null || host === null) return undefined;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return undefined;
  }
  if (originHost !== host) return undefined;
  const token = readCookies(headers.get("cookie")).get(sessionCookie);
  return token === "" ? undefined : token;
}
