// The restore drill (ADR 0052): backs the database NETHER_DATABASE_URL
// names up with the built admin command, restores the backup into a new,
// empty schema of the same server, as the documented procedure does, and
// checks the two hold the same rows. CI runs it after the smoke run, on a
// real PostgreSQL: `pnpm --filter @nether/server drill`.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const url = process.env.NETHER_DATABASE_URL ?? "";
if (url === "") {
  console.error("Set NETHER_DATABASE_URL to a PostgreSQL database to run the restore drill.");
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), "nether-drill-"));
const file = join(work, "drill.ndjson.gz");
const schema = `drill_${randomUUID().replaceAll("-", "")}`;
const separator = url.includes("?") ? "&" : "?";
const restoreUrl = `${url}${separator}options=-c%20search_path%3D${schema}`;

function admin(args, databaseUrl) {
  const run = spawnSync(process.execPath, ["dist/admin.js", ...args], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NETHER_DATABASE_URL: databaseUrl,
      NETHER_STORAGE_PATH: join(work, databaseUrl === url ? "store" : "restored-store"),
    },
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`admin ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  console.log(admin(["backup", file], url));
  await client.query(`CREATE SCHEMA ${schema}`);
  console.log(admin(["restore", file], restoreUrl));
  const count = async (where) => {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
      [where],
    );
    return rows[0].n;
  };
  const { rows: current } = await client.query("SELECT current_schema() AS name");
  const [from, to] = [await count(current[0].name), await count(schema)];
  if (from !== to) throw new Error(`The restored schema has ${to} tables, the original ${from}.`);
  console.log(`Restored into ${schema}: ${to} tables, as the original has.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
  await client.end();
  rmSync(work, { recursive: true, force: true });
}
