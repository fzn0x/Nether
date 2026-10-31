// Attachments: files kept by the SHA-256 of their bytes, once per workspace,
// sent and fetched by members, and the stores that keep them: a folder on
// disk, or an S3-compatible bucket.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { type IncomingMessage, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiskBlobs, S3Blobs } from "../src/blobs.ts";
import { type SetUp, type TestServer, bearer, setUp, startServer } from "./app.ts";

let running: TestServer | undefined;
const folders: string[] = [];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await running?.close();
  running = undefined;
  for (const close of closers.splice(0)) await close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "nether-blobs-"));
  folders.push(path);
  return path;
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

async function start(env: Record<string, string> = {}) {
  const root = await folder();
  running = await startServer({ blobs: new DiskBlobs(root), env });
  return { ...running, ...(await setUp(running)), root };
}

function send(test: TestServer & SetUp, bytes: Uint8Array, hash = sha(bytes), token = test.token) {
  return test.server.inject({
    method: "PUT",
    url: `/api/workspaces/${test.workspaceId}/attachments/${hash}`,
    headers: {
      ...bearer(token),
      "content-type": "application/octet-stream",
      "x-content-type": "image/png",
    },
    payload: Buffer.from(bytes),
  });
}

describe("attachments", () => {
  it("keeps a file once, by its hash, and gives it back to members", async () => {
    const test = await start();
    const hash = sha(png);
    const url = `/api/workspaces/${test.workspaceId}/attachments/${hash}`;
    const ask = () => test.server.inject({ method: "HEAD", url, headers: bearer(test.token) });
    expect((await ask()).statusCode).toBe(404);

    expect((await send(test, png, sha(new Uint8Array([1])))).statusCode).toBe(400);
    const sent = await send(test, png);
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toEqual({ hash, size: png.length });
    // Sent again, as by another device: kept as it was.
    expect((await send(test, png)).statusCode).toBe(200);
    expect((await ask()).statusCode).toBe(200);
    const files = await readdir(join(test.root, test.workspaceId), { recursive: true });
    expect(files.filter((file) => file.endsWith(hash))).toHaveLength(1);

    const fetched = await test.server.inject({ method: "GET", url, headers: bearer(test.token) });
    expect(fetched.statusCode).toBe(200);
    expect(new Uint8Array(fetched.rawPayload)).toEqual(png);
    expect(fetched.headers).toMatchObject({
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=31536000, immutable",
    });
    const missing = await test.server.inject({
      method: "GET",
      url: `/api/workspaces/${test.workspaceId}/attachments/${sha(new Uint8Array([9]))}`,
      headers: bearer(test.token),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("takes files from members only, and as large as the server allows", async () => {
    const test = await start({ NETHER_ATTACHMENT_LIMIT: "1" });
    const invited = await test.server.inject({
      method: "POST",
      url: `/api/workspaces/${test.workspaceId}/invitations`,
      headers: bearer(test.token),
      payload: { role: "member" },
    });
    const guest = await test.server.inject({
      method: "POST",
      url: "/api/invitations/accept",
      payload: {
        token: invited.json<{ token: string }>().token,
        name: "Gus",
        email: "gus@example.org",
        password: "gus's long password",
      },
    });
    const { token, user } = guest.json<{ token: string; user: { id: string } }>();
    await test.db.query("UPDATE memberships SET role = 'guest' WHERE user_id = $1", [user.id]);
    expect((await send(test, png, sha(png), token)).statusCode).toBe(403);

    const elsewhere = await test.server.inject({
      method: "PUT",
      url: `/api/workspaces/${randomUUID()}/attachments/${sha(png)}`,
      headers: { ...bearer(test.token), "content-type": "application/octet-stream" },
      payload: Buffer.from(png),
    });
    expect(elsewhere.statusCode).toBe(404);
    const unsigned = await test.server.inject({
      method: "PUT",
      url: `/api/workspaces/${test.workspaceId}/attachments/${sha(png)}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(png),
    });
    expect(unsigned.statusCode).toBe(401);
    const large = new Uint8Array(1024 * 1024 + 1);
    expect((await send(test, large)).statusCode).toBe(413);
  });

  it("keeps each workspace's files apart", async () => {
    const test = await start();
    await send(test, png);
    const made = await test.server.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: bearer(test.token),
      payload: { name: "Other" },
    });
    const other = made.json<{ id: string }>().id;
    const asked = await test.server.inject({
      method: "HEAD",
      url: `/api/workspaces/${other}/attachments/${sha(png)}`,
      headers: bearer(test.token),
    });
    expect(asked.statusCode).toBe(404);
  });
});

describe("blob stores", () => {
  const key = `${randomUUID()}/${sha(png)}`;

  it("keep a blob on disk once, written whole", async () => {
    const root = await folder();
    const blobs = new DiskBlobs(root);
    expect(await blobs.has(key)).toBe(false);
    expect(await blobs.get(key)).toBeUndefined();
    await blobs.put(key, png);
    await blobs.put(key, new Uint8Array([0]));
    expect(await blobs.get(key)).toEqual(png);
    const files = await readdir(root, { recursive: true });
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
    await blobs.delete(key);
    expect(await blobs.has(key)).toBe(false);
    await expect(blobs.put("../escape", png)).rejects.toThrow("Not a blob's key");
  });

  it("keep a blob in an S3-compatible bucket, with signed requests", async () => {
    const objects = new Map<string, Buffer>();
    const seen: { method: string; url: string; authorization: string }[] = [];
    const body = (request: IncomingMessage) =>
      new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      });
    const s3 = createServer((request, response) => {
      void (async () => {
        const url = request.url ?? "";
        seen.push({
          method: request.method ?? "",
          url,
          authorization: String(request.headers.authorization),
        });
        if (request.method === "PUT") {
          objects.set(url, await body(request));
          response.writeHead(200).end();
        } else if (request.method === "DELETE") {
          objects.delete(url);
          response.writeHead(204).end();
        } else {
          const object = objects.get(url);
          if (object === undefined) response.writeHead(404).end();
          else response.writeHead(200).end(request.method === "HEAD" ? undefined : object);
        }
      })();
    });
    await new Promise<void>((resolve) => s3.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise((resolve) =>
          s3.close(() => {
            resolve();
          }),
        ),
    );
    const blobs = new S3Blobs({
      endpoint: `http://127.0.0.1:${String((s3.address() as AddressInfo).port)}/`,
      bucket: "nether",
      region: "eu-west-1",
      accessKey: "access",
      secretKey: "secret",
    });
    expect(await blobs.has(key)).toBe(false);
    await blobs.put(key, png);
    await blobs.put(key, png);
    expect(await blobs.get(key)).toEqual(png);
    await blobs.delete(key);
    expect(await blobs.get(key)).toBeUndefined();

    expect(seen.map((request) => `${request.method} ${request.url}`)).toEqual([
      `HEAD /nether/${key}`,
      `HEAD /nether/${key}`,
      `PUT /nether/${key}`,
      `HEAD /nether/${key}`,
      `GET /nether/${key}`,
      `DELETE /nether/${key}`,
      `GET /nether/${key}`,
    ]);
    for (const request of seen) {
      expect(request.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=access\/\d{8}\/eu-west-1\/s3\/aws4_request, SignedHeaders=/,
      );
    }
  });
});
