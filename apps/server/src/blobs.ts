// Where attachments' bytes are kept (ADR 0039): a folder on the server's
// disk, or a bucket of any S3-compatible store (MinIO, Garage, Cloudflare
// R2, Amazon S3). A blob is named by its workspace and the SHA-256 of its
// bytes, so the same file is kept once in a workspace, and a blob never
// changes once written.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AwsClient } from "aws4fetch";

export interface BlobStore {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<Uint8Array | undefined>;
  /** Writes a blob; one already there stays as it is. */
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A key as `<workspace>/<sha256>`, checked so it names nothing else. */
function checked(key: string): readonly [string, string] {
  const match = /^([0-9a-f-]{36})\/([0-9a-f]{64})$/.exec(key);
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error(`Not a blob's key: ${key}`);
  return [match[1], match[2]];
}

/** Blobs as files in a folder: `<workspace>/<first two of the hash>/<hash>`. */
export class DiskBlobs implements BlobStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #path(key: string): string {
    const [workspace, hash] = checked(key);
    return join(this.#root, workspace, hash.slice(0, 2), hash);
  }

  async has(key: string): Promise<boolean> {
    try {
      await stat(this.#path(key));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.#path(key)));
    } catch {
      return undefined;
    }
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const path = this.#path(key);
    if (await this.has(key)) return;
    await mkdir(dirname(path), { recursive: true });
    // Written whole, then moved into place, so no one reads half a blob.
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }
}

export interface S3Options {
  /** The store's address, as `https://s3.example.org` or `http://minio:9000`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

/** Blobs as objects in an S3-compatible bucket, addressed by path. */
export class S3Blobs implements BlobStore {
  readonly #client: AwsClient;
  readonly #base: string;

  constructor(options: S3Options) {
    this.#client = new AwsClient({
      accessKeyId: options.accessKey,
      secretAccessKey: options.secretKey,
      service: "s3",
      region: options.region,
    });
    this.#base = `${options.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(options.bucket)}`;
  }

  #url(key: string): string {
    const [workspace, hash] = checked(key);
    return `${this.#base}/${workspace}/${hash}`;
  }

  async #send(key: string, init: RequestInit): Promise<Response> {
    const response = await this.#client.fetch(this.#url(key), init);
    if (!response.ok && response.status !== 404) {
      throw new Error(`The S3 store answered ${String(response.status)} for ${key}.`);
    }
    return response;
  }

  async has(key: string): Promise<boolean> {
    const response = await this.#send(key, { method: "HEAD" });
    return response.ok;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const response = await this.#send(key, { method: "GET" });
    if (!response.ok) return undefined;
    return new Uint8Array(await response.arrayBuffer());
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    if (await this.has(key)) return;
    await this.#send(key, {
      method: "PUT",
      // A copy, since fetch takes only bytes backed by an ArrayBuffer.
      body: data.slice(),
      headers: { "content-type": "application/octet-stream" },
    });
  }

  async delete(key: string): Promise<void> {
    await this.#send(key, { method: "DELETE" });
  }
}
