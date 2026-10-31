// The web app (ADR 0053), served at `/` from its build: its files as they
// are, the hashed ones kept by browsers for a year, the page and its
// service worker checked each time; and the page for any other path
// without a file's extension, as /invite and /sign-in, where the app reads
// what it was opened at. Every answer carries its content security policy:
// the page's own scripts, workers and WebAssembly, connections to this
// server only, images and media from it, blob: and data:, no frames.
import { readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { WebAppConfig } from "./config.ts";

export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  // Themes and the editor set styles in the page.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** The headers every answer of the web app carries. */
function guard(reply: FastifyReply): FastifyReply {
  return reply
    .header("content-security-policy", contentSecurityPolicy)
    .header("x-content-type-options", "nosniff")
    .header("referrer-policy", "no-referrer")
    .header("cross-origin-opener-policy", "same-origin")
    .header("x-frame-options", "DENY");
}

/** A file of the build, by the path asked for; undefined when it is not one, or climbs out. */
async function fileOf(dir: string, pathname: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.split("/").some((part) => part.startsWith("."))) {
    return undefined;
  }
  const full = join(dir, decoded);
  const inside = relative(dir, full);
  if (inside === "" || inside.startsWith("..") || inside.split(sep).includes("..")) {
    return undefined;
  }
  const found = await stat(full).catch(() => undefined);
  return found?.isFile() === true ? full : undefined;
}

/**
 * Serves the web app from its build, when there is one: a build the
 * configuration named must be there; the one found beside the server is
 * served only if it was built.
 */
export async function registerWebApp(
  app: FastifyInstance,
  config: WebAppConfig | null,
): Promise<boolean> {
  if (config === null) return false;
  const indexFile = join(config.dir, "index.html");
  const built = await stat(indexFile).catch(() => undefined);
  if (built?.isFile() !== true) {
    if (config.named) {
      throw new Error(
        `NETHER_WEB_APP names ${config.dir}, which has no index.html: build the web app, or set it to "off".`,
      );
    }
    app.log.info("The web app is not built here, so the server serves only its API.");
    return false;
  }

  // Read for each answer, small as it is, so a build made since shows.
  const page = async (reply: FastifyReply) =>
    guard(reply)
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-cache")
      .send(await readFile(indexFile));

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    const api = pathname === "/api" || pathname.startsWith("/api/") || pathname === "/health";
    if (api || (request.method !== "GET" && request.method !== "HEAD")) {
      return reply.code(404).send({
        statusCode: 404,
        error: "Not Found",
        message: `Route ${request.method}:${pathname} not found`,
      });
    }
    if (pathname === "/" || pathname === "/index.html") return page(reply);
    const file = await fileOf(config.dir, pathname);
    if (file === undefined) {
      // A path with a file's extension asks for a file the build lacks.
      if (extname(pathname) !== "")
        return guard(reply).code(404).type("text/plain").send("Not found");
      return page(reply);
    }
    const hashed = pathname.startsWith("/assets/");
    return guard(reply)
      .type(types[extname(file).toLowerCase()] ?? "application/octet-stream")
      .header("cache-control", hashed ? "public, max-age=31536000, immutable" : "no-cache")
      .send(await readFile(file));
  });
  return true;
}
