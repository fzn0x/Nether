// Scheduled backups (ADR 0052): every so many hours, a backup written to a
// folder or an S3-compatible bucket, the newest kept and the rest deleted.
// Of several nodes, one makes each backup: it claims it by moving the time
// the last one began on, in one statement, where it is due.
import { readdir, readFile, rm, copyFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import type { BlobStore } from "./blobs.ts";
import type { BackupConfig } from "./config.ts";
import type { Database } from "./db.ts";
import { backupBytesLines, backupFileLines, writeBackupFile } from "./backup.ts";

/** Where backups are kept: their names, newest last. */
export interface BackupTarget {
  list(): Promise<string[]>;
  /** Keeps a backup, copied from a local file. */
  save(name: string, file: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** A backup's lines, to restore it. */
  lines(name: string): Promise<AsyncIterable<string>>;
}

const namePattern = /^nether-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.ndjson\.gz$/;

/** A backup's name, by when it was made: names sort as their times do. */
export function backupName(now: Date): string {
  const time = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-");
  return `nether-backup-${time}.ndjson.gz`;
}

export function isBackupName(name: string): boolean {
  return namePattern.test(name);
}

/** Backups as files in a folder. */
export class DiskBackups implements BackupTarget {
  readonly #folder: string;

  constructor(folder: string) {
    this.#folder = folder;
  }

  async list(): Promise<string[]> {
    try {
      return (await readdir(this.#folder)).filter(isBackupName).sort();
    } catch {
      return [];
    }
  }

  async save(name: string, file: string): Promise<void> {
    await mkdir(this.#folder, { recursive: true });
    await copyFile(file, join(this.#folder, name));
  }

  async remove(name: string): Promise<void> {
    if (!isBackupName(name)) throw new Error(`Not a backup's name: ${name}`);
    await rm(join(this.#folder, name), { force: true });
  }

  async lines(name: string): Promise<AsyncIterable<string>> {
    const path = join(this.#folder, name);
    await stat(path);
    return backupFileLines(path);
  }
}

/** Backups as objects in an S3-compatible bucket, under a prefix. */
export class S3Backups implements BackupTarget {
  readonly #client: AwsClient;
  readonly #base: string;
  readonly #prefix: string;

  constructor(options: Extract<BackupConfig["target"], { kind: "s3" }>) {
    this.#client = new AwsClient({
      accessKeyId: options.accessKey,
      secretAccessKey: options.secretKey,
      service: "s3",
      region: options.region,
    });
    this.#base = `${options.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(options.bucket)}`;
    this.#prefix = options.prefix;
  }

  #url(name: string): string {
    if (!isBackupName(name)) throw new Error(`Not a backup's name: ${name}`);
    return `${this.#base}/${this.#prefix}${name}`;
  }

  async #send(url: string, init: RequestInit): Promise<Response> {
    const response = await this.#client.fetch(url, init);
    if (!response.ok) throw new Error(`The S3 store answered ${String(response.status)}.`);
    return response;
  }

  async list(): Promise<string[]> {
    const names: string[] = [];
    let token: string | undefined;
    do {
      const query = new URLSearchParams({ "list-type": "2", prefix: this.#prefix });
      if (token !== undefined) query.set("continuation-token", token);
      const xml = await (await this.#send(`${this.#base}?${query.toString()}`, {})).text();
      for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        const name = (match[1] ?? "").slice(this.#prefix.length);
        if (isBackupName(name)) names.push(name);
      }
      token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
    } while (token !== undefined);
    return names.sort();
  }

  async save(name: string, file: string): Promise<void> {
    await this.#send(this.#url(name), {
      method: "PUT",
      body: await readFile(file),
      headers: { "content-type": "application/gzip" },
    });
  }

  async remove(name: string): Promise<void> {
    await this.#send(this.#url(name), { method: "DELETE" });
  }

  async lines(name: string): Promise<AsyncIterable<string>> {
    const response = await this.#send(this.#url(name), {});
    return backupBytesLines(new Uint8Array(await response.arrayBuffer()));
  }
}

export function backupTarget(config: BackupConfig): BackupTarget {
  return config.target.kind === "disk"
    ? new DiskBackups(config.target.path)
    : new S3Backups(config.target);
}

/** A store with no files, for a server that keeps no attachments. */
export const noBlobs: BlobStore = {
  has: () => Promise.resolve(false),
  get: () => Promise.resolve(undefined),
  put: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};

/**
 * Makes a backup now, keeps it, and deletes the oldest beyond `keep`.
 * Gives its name and what it holds.
 */
export async function runBackup(
  db: Database,
  blobs: BlobStore,
  target: BackupTarget,
  keep: number,
  now = new Date(),
): Promise<{
  readonly name: string;
  readonly rows: number;
  readonly blobs: number;
  readonly missing: number;
}> {
  const name = backupName(now);
  const file = join(tmpdir(), `${name}.${String(process.pid)}.part`);
  try {
    const counts = await writeBackupFile(db, blobs, file, now);
    await target.save(name, file);
    const kept = await target.list();
    for (const old of kept.slice(0, Math.max(0, kept.length - keep))) await target.remove(old);
    return { name, ...counts };
  } finally {
    await rm(file, { force: true });
  }
}

/**
 * Makes a backup if one is due: when none has begun within `hours`, this
 * node claims the next, and makes it. A backup that fails gives its claim
 * back, so the next check tries again. Gives the backup made, if any.
 */
export async function backupIfDue(
  db: Database,
  blobs: BlobStore,
  target: BackupTarget,
  config: BackupConfig,
  now = new Date(),
): Promise<Awaited<ReturnType<typeof runBackup>> | undefined> {
  const { rows } = await db.query(
    `UPDATE backup_state SET last_started = $1
     WHERE last_started IS NULL OR last_started <= $1::timestamptz - make_interval(hours => $2)
     RETURNING true AS claimed`,
    [now.toISOString(), config.hours],
  );
  if (rows.length === 0) return undefined;
  try {
    return await runBackup(db, blobs, target, config.keep, now);
  } catch (error) {
    await db.query("UPDATE backup_state SET last_started = NULL WHERE last_started = $1", [
      now.toISOString(),
    ]);
    throw error;
  }
}
