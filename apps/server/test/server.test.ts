import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, serverVersion } from "../src/app.ts";
import { type Config, readConfig } from "../src/config.ts";
import type { Database } from "../src/db.ts";
import { type EnterpriseModule, enterpriseFeatures, switchVariable } from "../src/enterprise.ts";
import { migrate } from "../src/migrations.ts";
import { testDatabase } from "./database.ts";

const database = { NETHER_DATABASE_URL: "postgres://nether@localhost:5432/nether" };
const quiet = { ...database, NETHER_LOG_LEVEL: "silent" };
let app: FastifyInstance | undefined;
let db: Database | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await db?.close();
  db = undefined;
});

async function start(
  config: Config,
  modules: readonly EnterpriseModule[] = [],
): Promise<FastifyInstance> {
  db ??= await testDatabase();
  await migrate(db);
  app = await buildApp(config, { db, enterpriseModules: modules });
  return app;
}

describe("readConfig", () => {
  it("defaults to localhost:3000, info logs and every enterprise feature off", () => {
    expect(readConfig(database)).toEqual({
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
      databaseUrl: database.NETHER_DATABASE_URL,
      trustProxy: false,
      mail: null,
      publicUrl: null,
      oidc: null,
      storage: { kind: "disk", path: "data/attachments" },
      attachmentLimit: 100 * 1024 * 1024,
      enterprise: {
        sso: false,
        scim: false,
        audit: false,
        policies: false,
        admin: false,
        ha: false,
      },
    });
  });

  it("reads the address, the port, the log level and each switch", () => {
    const config = readConfig({
      ...database,
      NETHER_HOST: "0.0.0.0",
      NETHER_PORT: "0",
      NETHER_LOG_LEVEL: "WARN",
      NETHER_ENTERPRISE_SSO: "on",
      NETHER_ENTERPRISE_AUDIT: " TRUE ",
      NETHER_ENTERPRISE_HA: "off",
    });
    expect(config).toMatchObject({ host: "0.0.0.0", port: 0, logLevel: "warn" });
    expect(config.enterprise).toMatchObject({ sso: true, audit: true, ha: false, scim: false });
  });

  it.each([
    ["on", true],
    ["off", false],
    ["10.0.0.1", ["10.0.0.1"]],
    [" uniquelocal, 172.16.0.0/12 ,::1 ", ["uniquelocal", "172.16.0.0/12", "::1"]],
  ])("reads NETHER_TRUST_PROXY=%j", (value, trustProxy) => {
    expect(readConfig({ ...database, NETHER_TRUST_PROXY: value }).trustProxy).toEqual(trustProxy);
  });

  it("reads the SMTP server and the sender together", () => {
    const mail = {
      url: "smtps://nether:secret@mail.example.org:465",
      from: "Nether <nether@example.org>",
    };
    expect(
      readConfig({ ...database, NETHER_SMTP_URL: ` ${mail.url} `, NETHER_MAIL_FROM: mail.from })
        .mail,
    ).toEqual(mail);
    expect(
      readConfig({ ...database, NETHER_SMTP_URL: mail.url, NETHER_MAIL_FROM: "nether@example.org" })
        .mail?.from,
    ).toBe("nether@example.org");
  });

  it("reads where attachments are kept, and how large they may be", () => {
    expect(
      readConfig({
        ...database,
        NETHER_STORAGE_PATH: "/data/files",
        NETHER_ATTACHMENT_LIMIT: "25",
      }),
    ).toMatchObject({
      storage: { kind: "disk", path: "/data/files" },
      attachmentLimit: 25 * 1024 * 1024,
    });
    expect(
      readConfig({
        ...database,
        NETHER_STORAGE: "S3",
        NETHER_S3_ENDPOINT: "http://minio:9000/",
        NETHER_S3_BUCKET: "nether",
        NETHER_S3_ACCESS_KEY: "access",
        NETHER_S3_SECRET_KEY: "secret",
      }).storage,
    ).toEqual({
      kind: "s3",
      endpoint: "http://minio:9000",
      bucket: "nether",
      region: "us-east-1",
      accessKey: "access",
      secretKey: "secret",
    });
  });

  it("reads the server's address and its OpenID Connect provider", () => {
    const oidc = {
      NETHER_PUBLIC_URL: "https://nether.example.org/",
      NETHER_OIDC_ISSUER: "https://login.example.org/realms/team",
      NETHER_OIDC_CLIENT_ID: "nether",
    };
    expect(readConfig({ ...database, ...oidc })).toMatchObject({
      publicUrl: "https://nether.example.org",
      oidc: {
        issuer: "https://login.example.org/realms/team",
        clientId: "nether",
        clientSecret: null,
        name: "single sign-on",
        signUp: false,
      },
    });
    expect(
      readConfig({
        ...database,
        ...oidc,
        NETHER_OIDC_CLIENT_SECRET: "secret",
        NETHER_OIDC_NAME: "Keycloak",
        NETHER_OIDC_SIGN_UP: "on",
      }).oidc,
    ).toMatchObject({ clientSecret: "secret", name: "Keycloak", signUp: true });
  });

  it.each([
    [{ NETHER_PORT: "80a" }, 'NETHER_PORT must be a port number from 0 to 65535, not "80a"'],
    [{ NETHER_PORT: "65536" }, "NETHER_PORT must be a port number"],
    [{ NETHER_PORT: "-1" }, "NETHER_PORT must be a port number"],
    [{ NETHER_LOG_LEVEL: "loud" }, "NETHER_LOG_LEVEL must be one of fatal, error, warn, info"],
    [{ NETHER_ENTERPRISE_SCIM: "maybe" }, 'NETHER_ENTERPRISE_SCIM must be on or off, not "maybe"'],
    [
      { NETHER_DATABASE_URL: "" },
      "NETHER_DATABASE_URL must be set to the PostgreSQL database's address",
    ],
    [
      { NETHER_DATABASE_URL: "mysql://db/nether" },
      "NETHER_DATABASE_URL must be a postgres:// address",
    ],
    [
      { NETHER_TRUST_PROXY: "2" },
      'NETHER_TRUST_PROXY must be on, off, or the proxies\' addresses and ranges separated by commas, not "2"',
    ],
    [{ NETHER_TRUST_PROXY: "proxy.example.org" }, "NETHER_TRUST_PROXY must be on, off"],
    [{ NETHER_TRUST_PROXY: "10.0.0.0/33" }, "NETHER_TRUST_PROXY must be on, off"],
    [{ NETHER_TRUST_PROXY: "10.0.0.1," }, "NETHER_TRUST_PROXY must be on, off"],
    [{ NETHER_MAIL_FROM: "nether@example.org" }, "NETHER_MAIL_FROM is set without NETHER_SMTP_URL"],
    [
      { NETHER_SMTP_URL: "http://mail.example.org", NETHER_MAIL_FROM: "nether@example.org" },
      "NETHER_SMTP_URL must be an smtp:// or smtps:// address",
    ],
    [{ NETHER_SMTP_URL: "smtp://mail.example.org" }, "NETHER_MAIL_FROM must be the address"],
    [
      { NETHER_PUBLIC_URL: "nether.example.org" },
      'NETHER_PUBLIC_URL must be an http:// or https:// address, not "nether.example.org"',
    ],
    [{ NETHER_PUBLIC_URL: "https://nether.example.org/?a=1" }, "NETHER_PUBLIC_URL must be an"],
    [{ NETHER_STORAGE: "floppy" }, 'NETHER_STORAGE must be disk or s3, not "floppy"'],
    [{ NETHER_STORAGE: "s3" }, "NETHER_S3_ENDPOINT must be set"],
    [
      { NETHER_STORAGE: "s3", NETHER_S3_ENDPOINT: "http://minio:9000" },
      "NETHER_S3_BUCKET must be set when NETHER_STORAGE is s3",
    ],
    [{ NETHER_ATTACHMENT_LIMIT: "0" }, "NETHER_ATTACHMENT_LIMIT must be a number of mebibytes"],
    [
      { NETHER_OIDC_CLIENT_ID: "nether" },
      "NETHER_OIDC_CLIENT_ID is set without NETHER_OIDC_ISSUER",
    ],
    [
      {
        NETHER_OIDC_ISSUER: "https://login.example.org",
        NETHER_PUBLIC_URL: "https://n.example.org",
      },
      "NETHER_OIDC_CLIENT_ID must be set with NETHER_OIDC_ISSUER",
    ],
    [
      { NETHER_OIDC_ISSUER: "https://login.example.org", NETHER_OIDC_CLIENT_ID: "nether" },
      "NETHER_PUBLIC_URL must be set with NETHER_OIDC_ISSUER",
    ],
    [
      { NETHER_SMTP_URL: "smtp://mail.example.org", NETHER_MAIL_FROM: "Nether" },
      "NETHER_MAIL_FROM must be the address",
    ],
  ])("rejects %j", (env, message) => {
    expect(() => readConfig({ ...database, ...env })).toThrow(message);
  });

  it("names a switch for every enterprise feature", () => {
    expect(enterpriseFeatures.map(switchVariable)).toEqual([
      "NETHER_ENTERPRISE_SSO",
      "NETHER_ENTERPRISE_SCIM",
      "NETHER_ENTERPRISE_AUDIT",
      "NETHER_ENTERPRISE_POLICIES",
      "NETHER_ENTERPRISE_ADMIN",
      "NETHER_ENTERPRISE_HA",
    ]);
  });
});

describe("GET /health", () => {
  it("answers with the version and every enterprise feature off", async () => {
    const server = await start(readConfig(quiet));
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      version: serverVersion(),
      enterprise: {
        sso: false,
        scim: false,
        audit: false,
        policies: false,
        admin: false,
        ha: false,
      },
    });
  });

  it("answers no route it does not have", async () => {
    const server = await start(readConfig(quiet));
    expect((await server.inject({ method: "GET", url: "/" })).statusCode).toBe(404);
  });
});

describe("enterprise features", () => {
  it("refuse to start when one is on and this build has no module for it", async () => {
    await expect(start(readConfig({ ...quiet, NETHER_ENTERPRISE_AUDIT: "on" }))).rejects.toThrow(
      "NETHER_ENTERPRISE_AUDIT is on, but this build of Nether has no audit module",
    );
  });

  it("register a module only when its switch is on", async () => {
    const audit: EnterpriseModule = {
      feature: "audit",
      plugin: (instance) => {
        instance.get("/audit", () => ({ entries: [] }));
        return Promise.resolve();
      },
    };
    const off = await start(readConfig(quiet), [audit]);
    expect((await off.inject({ method: "GET", url: "/audit" })).statusCode).toBe(404);
    await off.close();

    const on = await start(readConfig({ ...quiet, NETHER_ENTERPRISE_AUDIT: "on" }), [audit]);
    expect((await on.inject({ method: "GET", url: "/audit" })).json()).toEqual({ entries: [] });
    expect((await on.inject({ method: "GET", url: "/health" })).json()).toMatchObject({
      enterprise: { audit: true, sso: false },
    });
  });
});
