// A server for a test, on a database of its own, and its setup.
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import type { BlobStore } from "../src/blobs.ts";
import type { Database } from "../src/db.ts";
import type { Mailer, Message } from "../src/mail.ts";
import { migrate } from "../src/migrations.ts";
import { newSetupCode } from "../src/setup.ts";
import { testDatabase } from "./database.ts";

export interface TestServer {
  readonly server: FastifyInstance;
  readonly db: Database;
  readonly setupCode: string;
  close(): Promise<void>;
}

const baseEnv = {
  NETHER_DATABASE_URL: "postgres://nether@localhost:5432/nether",
  NETHER_LOG_LEVEL: "silent",
  // The API alone, whether or not the web app was built here.
  NETHER_WEB_APP: "off",
};

/** A mailer that keeps what it is sent, for a test to read in order. */
export class TestMailer implements Mailer {
  readonly sent: Message[] = [];
  private readonly unread: Message[] = [];
  private readonly waiting: ((message: Message) => void)[] = [];

  send(message: Message): Promise<void> {
    this.sent.push(message);
    const waiter = this.waiting.shift();
    if (waiter === undefined) this.unread.push(message);
    else waiter(message);
    return Promise.resolve();
  }

  /** The next message not yet read, when it is sent. */
  next(): Promise<Message> {
    const message = this.unread.shift();
    if (message !== undefined) return Promise.resolve(message);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  close(): void {
    // Nothing to close.
  }
}

/** Starts a server, configured by `env` beside what every test server has. */
export async function startServer(
  options: { mailer?: Mailer; env?: Record<string, string>; blobs?: BlobStore } = {},
): Promise<TestServer> {
  const db = await testDatabase();
  await migrate(db);
  const setupCode = newSetupCode();
  const config = readConfig({ ...baseEnv, ...options.env });
  const server = await buildApp(config, {
    db,
    setupCode,
    ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
    ...(options.blobs === undefined ? {} : { blobs: options.blobs }),
  });
  return {
    server,
    db,
    setupCode,
    async close() {
      await server.close();
      await db.close();
    },
  };
}

export const admin = {
  name: "Ada",
  email: "Ada@Example.org",
  password: "a long password",
  workspace: "Team",
} as const;

/** The admin's session and first workspace, as setup makes them. */
export interface SetUp {
  readonly token: string;
  readonly userId: string;
  readonly workspaceId: string;
}

export async function setUp({ server, setupCode }: TestServer): Promise<SetUp> {
  const response = await server.inject({
    method: "POST",
    url: "/api/setup",
    payload: { ...admin, code: setupCode },
  });
  if (response.statusCode !== 201) throw new Error(`Setup failed: ${response.body}`);
  const body = response.json<{ token: string; user: { id: string }; workspace: { id: string } }>();
  return { token: body.token, userId: body.user.id, workspaceId: body.workspace.id };
}

/** The header that sends a session's token. */
export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/** Signs in, and gives the response. */
export function signIn(
  server: FastifyInstance,
  email: string,
  password: string,
  client = "test",
): Promise<LightMyRequestResponse> {
  return server.inject({
    method: "POST",
    url: "/api/sessions",
    headers: { "user-agent": client },
    payload: { email, password },
  });
}
