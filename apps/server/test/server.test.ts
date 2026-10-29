import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, serverVersion } from "../src/app.ts";
import { type Config, readConfig } from "../src/config.ts";
import { type EnterpriseModule, enterpriseFeatures, switchVariable } from "../src/enterprise.ts";

const quiet = { NETHER_LOG_LEVEL: "silent" };
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(
  config: Config,
  modules: readonly EnterpriseModule[] = [],
): Promise<FastifyInstance> {
  app = await buildApp(config, modules);
  return app;
}

describe("readConfig", () => {
  it("defaults to localhost:3000, info logs and every enterprise feature off", () => {
    expect(readConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
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
    [{ NETHER_PORT: "80a" }, 'NETHER_PORT must be a port number from 0 to 65535, not "80a"'],
    [{ NETHER_PORT: "65536" }, "NETHER_PORT must be a port number"],
    [{ NETHER_PORT: "-1" }, "NETHER_PORT must be a port number"],
    [{ NETHER_LOG_LEVEL: "loud" }, "NETHER_LOG_LEVEL must be one of fatal, error, warn, info"],
    [{ NETHER_ENTERPRISE_SCIM: "maybe" }, 'NETHER_ENTERPRISE_SCIM must be on or off, not "maybe"'],
  ])("rejects %j", (env, message) => {
    expect(() => readConfig(env)).toThrow(message);
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

  it("is the only route so far", async () => {
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
