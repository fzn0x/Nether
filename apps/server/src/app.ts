import { readFileSync } from "node:fs";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAttachments } from "./attachments.ts";
import type { BlobStore } from "./blobs.ts";
import { registerCodes } from "./codes.ts";
import type { Config } from "./config.ts";
import type { Database } from "./db.ts";
import { type EnterpriseModule, enterpriseFeatures, registerEnterprise } from "./enterprise.ts";
import { tooManyTries } from "./http.ts";
import { registerInvitations } from "./invitations.ts";
import { registerMembers } from "./members.ts";
import { purgeNotifications, registerNotifications } from "./notifications.ts";
import type { Mailer } from "./mail.ts";
import { registerOidc } from "./oidc.ts";
import { registerSessions } from "./sessions.ts";
import { registerSetup } from "./setup.ts";
import { registerRelay } from "./relay.ts";
import { registerSync } from "./sync.ts";
import { registerUnits } from "./units.ts";
import { purgeVersions, registerVersions } from "./versions.ts";
import { registerWorkspaces } from "./workspaces.ts";

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

/** What the server runs with besides its configuration. */
export interface Services {
  readonly db: Database;
  /** The code first-run setup asks for, while the server has no account. */
  readonly setupCode?: string;
  /** What sends email, when the admin has named an SMTP server. */
  readonly mailer?: Mailer;
  /** Where attachments' bytes are kept; without it, the server takes none. */
  readonly blobs?: BlobStore;
  /** The modules of the enterprise features this build includes; none are written yet. */
  readonly enterpriseModules?: readonly EnterpriseModule[];
}

/** Builds the server: its routes, and the modules of the enterprise features that are switched on. */
export async function buildApp(config: Config, services: Services): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: typeof config.trustProxy === "boolean" ? config.trustProxy : [...config.trustProxy],
  });
  // Limits apply only to the routes that ask for one, as signing in does.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: tooManyTries(Math.ceil(context.ttl / 1000)),
    }),
  });
  const version = serverVersion();

  app.get("/health", { schema: healthSchema }, () => ({
    status: "ok",
    version,
    enterprise: config.enterprise,
  }));

  registerSetup(app, services.db, services.setupCode);
  registerSessions(app, services.db);
  registerInvitations(app, services.db);
  registerWorkspaces(app, services.db);
  registerVersions(app, services.db);
  registerNotifications(app, services.db, services.mailer);
  // Versions older than the admin keeps them, and old notifications, go on
  // start, then every hour.
  const purge = async () => {
    await purgeVersions(services.db, config.historyDays).catch((error: unknown) => {
      app.log.error({ err: error }, "Could not delete the versions kept too long");
    });
    await purgeNotifications(services.db).catch((error: unknown) => {
      app.log.error({ err: error }, "Could not delete the notifications kept too long");
    });
  };
  const hourly = setInterval(() => void purge(), 3_600_000);
  hourly.unref();
  app.addHook("onReady", async () => {
    await purge();
  });
  app.addHook("onClose", (_instance, done) => {
    clearInterval(hourly);
    done();
  });
  if (services.blobs !== undefined) {
    registerAttachments(app, services.db, services.blobs, config.attachmentLimit);
  }
  // The relay's sockets come through the WebSocket plugin sync registers.
  const sync = await registerSync(app, services.db);
  const relay = registerRelay(app, services.db);
  const reconnect = (userId: string) => {
    sync.disconnect(userId);
    relay.disconnect(userId);
  };
  registerMembers(app, services.db, reconnect);
  registerUnits(app, services.db, reconnect, sync);
  if (services.mailer !== undefined) registerCodes(app, services.db, services.mailer);
  const { oidc, publicUrl } = config;
  if (oidc !== null && publicUrl !== null) registerOidc(app, services.db, oidc, publicUrl);
  // How the app may offer to sign in on this server.
  app.get("/api/sign-in-methods", () => ({
    password: true,
    emailCode: services.mailer !== undefined,
    oidc: oidc === null ? null : { name: oidc.name },
  }));
  await registerEnterprise(app, config.enterprise, services.enterpriseModules ?? []);
  return app;
}
