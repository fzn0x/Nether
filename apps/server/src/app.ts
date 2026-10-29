import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import { type EnterpriseModule, enterpriseFeatures, registerEnterprise } from "./enterprise.ts";

/** The server's version, from its package.json (one folder up from src/ and dist/ alike). */
export function serverVersion(): string {
  const text = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(text) as { version: string }).version;
}

const healthSchema = {
  response: {
    200: {
      type: "object",
      required: ["status", "version", "enterprise"],
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["ok"] },
        version: { type: "string" },
        enterprise: {
          type: "object",
          required: [...enterpriseFeatures],
          additionalProperties: false,
          properties: Object.fromEntries(
            enterpriseFeatures.map((feature) => [feature, { type: "boolean" }]),
          ),
        },
      },
    },
  },
} as const;

/**
 * Builds the server: its routes, and the modules of the enterprise features
 * that are switched on. `enterpriseModules` holds what this build includes;
 * none are written yet.
 */
export async function buildApp(
  config: Config,
  enterpriseModules: readonly EnterpriseModule[] = [],
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });
  const version = serverVersion();

  app.get("/health", { schema: healthSchema }, () => ({
    status: "ok",
    version,
    enterprise: config.enterprise,
  }));

  await registerEnterprise(app, config.enterprise, enterpriseModules);
  return app;
}
