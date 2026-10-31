// The web app at `/` (ADR 0053): its build's files, cached as they should
// be, its page for the app's own paths, nothing outside the build, the
// API's answers as they were, and its content security policy.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/web.ts";
import { type TestServer, startServer } from "./app.ts";

let running: TestServer | undefined;
let build: string | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
  if (build !== undefined) await rm(build, { recursive: true, force: true });
  build = undefined;
});

/** A web app's build, as apps/web makes one, and a file beside it no one should get. */
async function webBuild(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nether-web-"));
  build = root;
  const dir = join(root, "dist");
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Nether</title>");
  await writeFile(join(dir, "assets", "index-abc123.js"), "console.log('app');");
  await writeFile(join(dir, "assets", "sqlite3-def456.wasm"), new Uint8Array([0, 97, 115, 109]));
  await writeFile(join(dir, "sw.js"), "// the service worker");
  await writeFile(join(dir, "manifest.webmanifest"), "{}");
  await writeFile(join(root, "secret.txt"), "not served");
  return dir;
}

describe("the web app", () => {
  it("serves its page and files, cached as they should be, with its policy", async () => {
    running = await startServer({ env: { NETHER_WEB_APP: await webBuild() } });
    const get = (url: string) => running?.server.inject({ method: "GET", url });

    const page = await get("/");
    expect(page?.statusCode).toBe(200);
    expect(page?.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page?.headers["cache-control"]).toBe("no-cache");
    expect(page?.headers["content-security-policy"]).toBe(contentSecurityPolicy);
    expect(page?.headers["x-content-type-options"]).toBe("nosniff");
    expect(page?.headers["x-frame-options"]).toBe("DENY");
    expect(page?.body).toContain("<title>Nether</title>");

    const script = await get("/assets/index-abc123.js");
    expect(script?.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(script?.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await get("/assets/sqlite3-def456.wasm"))?.headers["content-type"]).toBe(
      "application/wasm",
    );
    const worker = await get("/sw.js");
    expect(worker?.headers["cache-control"]).toBe("no-cache");
    expect((await get("/manifest.webmanifest"))?.headers["content-type"]).toBe(
      "application/manifest+json; charset=utf-8",
    );
  });

  it("answers the app's own paths with its page, and a missing file with 404", async () => {
    running = await startServer({ env: { NETHER_WEB_APP: await webBuild() } });
    const get = (url: string) => running?.server.inject({ method: "GET", url });
    for (const path of ["/invite", "/sign-in", "/sign-in/provider?code=x"]) {
      const answer = await get(path);
      expect(answer?.statusCode).toBe(200);
      expect(answer?.body).toContain("<title>Nether</title>");
    }
    expect((await get("/assets/gone-000000.js"))?.statusCode).toBe(404);
  });

  it("gives nothing outside its build, nor hidden files", async () => {
    const dir = await webBuild();
    await writeFile(join(dir, ".env"), "SECRET=1");
    running = await startServer({ env: { NETHER_WEB_APP: dir } });
    for (const path of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/assets/..%2f..%2fsecret.txt",
      "/.env",
    ]) {
      const answer = await running.server.inject({ method: "GET", url: path });
      expect(answer.body, path).not.toContain("not served");
      expect(answer.body, path).not.toContain("SECRET");
    }
  });

  it("leaves the API's answers as they were", async () => {
    running = await startServer({ env: { NETHER_WEB_APP: await webBuild() } });
    const missing = await running.server.inject({ method: "GET", url: "/api/nothing-here" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ message: string }>().message).toBe(
      "Route GET:/api/nothing-here not found",
    );
    const posted = await running.server.inject({ method: "POST", url: "/somewhere" });
    expect(posted.statusCode).toBe(404);
    expect((await running.server.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("must be there when named, and is left out when it was not built", async () => {
    await expect(
      startServer({ env: { NETHER_WEB_APP: join(tmpdir(), "no-such-nether-build") } }),
    ).rejects.toThrow("has no index.html");
  });
});
