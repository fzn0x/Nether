// The database's schema brought up to date as the server starts, passwords
// kept as argon2id hashes, and first-run setup: the admin and the first
// workspace, made once, for whoever has the code the server logged.
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import type { Database } from "../src/db.ts";
import { NewerDatabase, migrate, migrations, schemaVersion } from "../src/migrations.ts";
import { hashPassword, verifyPassword } from "../src/passwords.ts";
import { newSetupCode, setupNeeded } from "../src/setup.ts";
import { testDatabase } from "./database.ts";

const config = readConfig({
  NETHER_DATABASE_URL: "postgres://nether@localhost:5432/nether",
  NETHER_LOG_LEVEL: "silent",
});
const opened: Database[] = [];
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const db of opened.splice(0)) await db.close();
});

async function database(): Promise<Database> {
  const db = await testDatabase();
  opened.push(db);
  return db;
}

describe("migrate", () => {
  it("brings a new database to the schema once, and records each migration", async () => {
    const db = await database();
    expect(await migrate(db)).toEqual({ from: 0, to: schemaVersion });
    expect(await migrate(db)).toEqual({ from: schemaVersion, to: schemaVersion });
    const { rows } = await db.query("SELECT version FROM schema_migrations ORDER BY version");
    expect(rows.map((row) => row.version)).toEqual(migrations.map((item) => item.version));
    const tables = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "documents",
      "encrypted_updates",
      "identities",
      "invitations",
      "memberships",
      "oidc_flows",
      "schema_migrations",
      "sessions",
      "sign_in_codes",
      "user_keys",
      "users",
      "workspace_keys",
      "workspaces",
    ]);
  });

  it("will not start on a database a newer server migrated", async () => {
    const db = await database();
    await migrate(db);
    await db.query("INSERT INTO schema_migrations (version, name) VALUES ($1, 'from the future')", [
      schemaVersion + 1,
    ]);
    await expect(migrate(db)).rejects.toThrow(NewerDatabase);
    await expect(migrate(db)).rejects.toThrow(
      `The database's schema is at version ${String(schemaVersion + 1)}, newer than this server's ${String(schemaVersion)}`,
    );
  });
});

describe("passwords", () => {
  it("are kept as argon2id hashes, each with its own salt", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await hashPassword("correct horse battery")).not.toBe(hash);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
  });
});

describe("first-run setup", () => {
  const admin = {
    name: "Ada",
    email: "Ada@Example.org",
    password: "a long password",
    workspace: "Team",
  };

  async function start(code: string | undefined) {
    const db = await database();
    await migrate(db);
    app = await buildApp(config, { db, ...(code === undefined ? {} : { setupCode: code }) });
    return { db, server: app };
  }

  it("writes codes that are long, clear to read aloud, and new each time", () => {
    const code = newSetupCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
    expect(newSetupCode()).not.toBe(code);
  });

  it("makes the admin and the first workspace once, for the code the server logged", async () => {
    const code = newSetupCode();
    const { db, server } = await start(code);
    expect((await server.inject({ method: "GET", url: "/api/setup" })).json()).toEqual({
      needed: true,
    });

    const wrong = await server.inject({
      method: "POST",
      url: "/api/setup",
      payload: { ...admin, code: "AAAAA-AAAAA-AAAAA-AAAAA" },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({
      statusCode: 403,
      error: "Forbidden",
      message: "That is not the setup code the server wrote to its log.",
    });
    expect(await setupNeeded(db)).toBe(true);

    // The code as someone types it: lowercase, without its dashes.
    const made = await server.inject({
      method: "POST",
      url: "/api/setup",
      payload: { ...admin, code: code.replaceAll("-", "").toLowerCase() },
    });
    expect(made.statusCode).toBe(201);
    const body = made.json<{
      token: string;
      user: { id: string; email: string; name: string };
      workspace: { id: string; name: string };
    }>();
    expect(body).toMatchObject({
      user: { email: "Ada@Example.org", name: "Ada", instanceAdmin: true },
      workspace: { name: "Team", role: "owner" },
    });
    // Setup signs the admin in.
    const me = await server.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.json()).toMatchObject({ user: { id: body.user.id } });

    const user = await db.query(
      "SELECT email_key, instance_admin, password_hash FROM users WHERE id = $1",
      [body.user.id],
    );
    expect(user.rows[0]).toMatchObject({ email_key: "ada@example.org", instance_admin: true });
    const hash = user.rows[0]?.password_hash;
    expect(typeof hash === "string" && (await verifyPassword(admin.password, hash))).toBe(true);
    const member = await db.query(
      "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2",
      [body.workspace.id, body.user.id],
    );
    expect(member.rows).toEqual([{ role: "owner" }]);

    expect((await server.inject({ method: "GET", url: "/api/setup" })).json()).toEqual({
      needed: false,
    });
    const again = await server.inject({
      method: "POST",
      url: "/api/setup",
      payload: { ...admin, email: "eve@example.org", code },
    });
    expect(again.statusCode).toBe(409);
  });

  it("refuses without a code, and what the account cannot have", async () => {
    const closed = await start(undefined);
    const noCode = await closed.server.inject({
      method: "POST",
      url: "/api/setup",
      payload: { ...admin, code: "AAAAA-AAAAA-AAAAA-AAAAA" },
    });
    expect(noCode.statusCode).toBe(403);
    await app?.close();

    const code = newSetupCode();
    const { server } = await start(code);
    for (const payload of [
      { ...admin, code, password: "short" },
      { ...admin, code, email: "not an address" },
      { ...admin, code, name: "   " },
      { ...admin, code, workspace: "" },
    ]) {
      const response = await server.inject({ method: "POST", url: "/api/setup", payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});
