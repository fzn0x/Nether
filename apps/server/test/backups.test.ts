// Scheduled backups (ADR 0052): one made when due and not before, the
// newest kept, a failed one tried again; and how the environment asks for
// them.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BackupTarget,
  DiskBackups,
  backupIfDue,
  backupName,
  isBackupName,
  noBlobs,
} from "../src/backups.ts";
import { type BackupConfig, ConfigError, readConfig } from "../src/config.ts";
import type { Database } from "../src/db.ts";
import { migrate } from "../src/migrations.ts";
import { testDatabase } from "./database.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setUp(): Promise<{ db: Database; folder: string }> {
  const db = await testDatabase();
  cleanups.push(() => db.close());
  await migrate(db);
  const folder = await mkdtemp(join(tmpdir(), "nether-backups-"));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  return { db, folder };
}

const hour = 3_600_000;

describe("scheduled backups", () => {
  it("are made when due and not before, keeping the newest", async () => {
    const { db, folder } = await setUp();
    const target = new DiskBackups(folder);
    const config: BackupConfig = { target: { kind: "disk", path: folder }, hours: 24, keep: 2 };
    const start = new Date("2026-11-01T03:00:00Z");
    const at = (hours: number) => new Date(start.getTime() + hours * hour);

    expect((await backupIfDue(db, noBlobs, target, config, at(0)))?.name).toBe(
      "nether-backup-2026-11-01T03-00-00Z.ndjson.gz",
    );
    expect(await backupIfDue(db, noBlobs, target, config, at(23))).toBeUndefined();
    expect(await backupIfDue(db, noBlobs, target, config, at(24))).toBeDefined();
    expect(await backupIfDue(db, noBlobs, target, config, at(48))).toBeDefined();
    expect(await target.list()).toEqual([
      "nether-backup-2026-11-02T03-00-00Z.ndjson.gz",
      "nether-backup-2026-11-03T03-00-00Z.ndjson.gz",
    ]);
    // A backup kept reads back.
    const lines = await target.lines("nether-backup-2026-11-03T03-00-00Z.ndjson.gz");
    for await (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({ format: "nether-backup" });
      break;
    }
  });

  it("are tried again at the next check when one fails", async () => {
    const { db, folder } = await setUp();
    const config: BackupConfig = { target: { kind: "disk", path: folder }, hours: 24, keep: 7 };
    const failing: BackupTarget = {
      list: () => Promise.resolve([]),
      save: () => Promise.reject(new Error("The disk is full.")),
      remove: () => Promise.resolve(),
      lines: () => Promise.reject(new Error("none")),
    };
    const now = new Date("2026-11-01T03:00:00Z");
    await expect(backupIfDue(db, noBlobs, failing, config, now)).rejects.toThrow("full");
    const later = new Date(now.getTime() + 600_000);
    expect(await backupIfDue(db, noBlobs, new DiskBackups(folder), config, later)).toBeDefined();
  });

  it("are named by their time, which only names of backups match", () => {
    const name = backupName(new Date("2026-11-01T03:04:05.678Z"));
    expect(name).toBe("nether-backup-2026-11-01T03-04-05Z.ndjson.gz");
    expect(isBackupName(name)).toBe(true);
    expect(isBackupName("../etc/passwd")).toBe(false);
    expect(isBackupName("nether-backup-latest.ndjson.gz")).toBe(false);
  });
});

describe("the backup settings", () => {
  const base = { NETHER_DATABASE_URL: "postgres://localhost/nether" };

  it("are off unless asked for, and to a folder or a bucket", () => {
    expect(readConfig(base).backup).toBeNull();
    expect(readConfig({ ...base, NETHER_BACKUP: "off" }).backup).toBeNull();
    expect(readConfig({ ...base, NETHER_BACKUP: "disk" }).backup).toEqual({
      target: { kind: "disk", path: "data/backups" },
      hours: 24,
      keep: 7,
    });
    expect(
      readConfig({
        ...base,
        NETHER_BACKUP: "s3",
        NETHER_S3_ENDPOINT: "https://s3.example.org",
        NETHER_S3_ACCESS_KEY: "key",
        NETHER_S3_SECRET_KEY: "secret",
        NETHER_BACKUP_S3_BUCKET: "backups",
        NETHER_BACKUP_S3_PREFIX: "/nether",
        NETHER_BACKUP_HOURS: "6",
        NETHER_BACKUP_KEEP: "30",
      }).backup,
    ).toEqual({
      target: {
        kind: "s3",
        endpoint: "https://s3.example.org",
        bucket: "backups",
        region: "us-east-1",
        accessKey: "key",
        secretKey: "secret",
        prefix: "nether/",
      },
      hours: 6,
      keep: 30,
    });
  });

  it("name the variable at fault", () => {
    const fails = (env: Record<string, string>, variable: string) => {
      try {
        readConfig({ ...base, ...env });
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as Error).message).toContain(variable);
        return;
      }
      throw new Error(`${variable} was not refused`);
    };
    fails({ NETHER_BACKUP: "tape" }, "NETHER_BACKUP");
    fails({ NETHER_BACKUP: "disk", NETHER_BACKUP_HOURS: "0" }, "NETHER_BACKUP_HOURS");
    fails({ NETHER_BACKUP: "disk", NETHER_BACKUP_KEEP: "many" }, "NETHER_BACKUP_KEEP");
    fails({ NETHER_BACKUP: "s3" }, "NETHER_S3_ENDPOINT");
    fails(
      { NETHER_BACKUP: "s3", NETHER_S3_ENDPOINT: "https://s3.example.org" },
      "NETHER_BACKUP_S3_BUCKET",
    );
  });
});
