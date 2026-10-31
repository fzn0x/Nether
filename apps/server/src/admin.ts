// What an admin runs beside the server (ADR 0052), configured by the same
// environment variables:
//
//   node dist/admin.js backup [file]   makes a backup now, to the configured
//                                      place, or to a file
//   node dist/admin.js backups         lists the backups kept
//   node dist/admin.js restore <name or file>
//                                      restores one into the database
//                                      NETHER_DATABASE_URL names, which must
//                                      be empty, and its attachments into
//                                      the configured store
import { DiskBlobs, S3Blobs } from "./blobs.ts";
import { backupFileLines, restoreBackupLines, writeBackupFile } from "./backup.ts";
import { backupTarget, isBackupName, runBackup } from "./backups.ts";
import { readConfig } from "./config.ts";
import { connectPostgres } from "./db.ts";
import { migrate } from "./migrations.ts";

function print(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(args: readonly string[]): Promise<void> {
  const [command, argument] = args;
  const config = readConfig(process.env);
  const blobs =
    config.storage.kind === "disk"
      ? new DiskBlobs(config.storage.path)
      : new S3Blobs(config.storage);
  const target = config.backup === null ? undefined : backupTarget(config.backup);
  const db = connectPostgres(config.databaseUrl);
  try {
    if (command === "backup") {
      if (argument !== undefined) {
        await migrate(db);
        const made = await writeBackupFile(db, blobs, argument);
        print(`Wrote ${argument}: ${String(made.rows)} rows, ${String(made.blobs)} attachments.`);
      } else {
        if (target === undefined || config.backup === null) {
          throw new Error(
            "Set NETHER_BACKUP to disk or s3, or name a file to write the backup to.",
          );
        }
        await migrate(db);
        const made = await runBackup(db, blobs, target, config.backup.keep);
        print(`Made ${made.name}: ${String(made.rows)} rows, ${String(made.blobs)} attachments.`);
      }
    } else if (command === "backups") {
      if (target === undefined) throw new Error("Set NETHER_BACKUP to disk or s3 to list backups.");
      for (const name of await target.list()) print(name);
    } else if (command === "restore" && argument !== undefined) {
      const lines =
        isBackupName(argument) && target !== undefined
          ? await target.lines(argument)
          : backupFileLines(argument);
      const restored = await restoreBackupLines(db, blobs, lines);
      print(
        `Restored ${String(restored.rows)} rows and ${String(restored.blobs)} attachments, made at schema version ${String(restored.schema)}.`,
      );
    } else {
      print("Use: node dist/admin.js backup [file] | backups | restore <name or file>");
      process.exitCode = 2;
    }
  } finally {
    await db.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
