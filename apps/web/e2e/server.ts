// A real Nether server for the web app's end-to-end tests: PostgreSQL in
// the process (PGlite), the web app's build at `/`, email kept for the tests
// to read, and an OpenID Connect provider standing in for single sign-on.
// Beside it, on its own port, what the tests ask of it: the emails sent, a
// new person in the workspace, and the provider's sign-in, done as the
// provider's own page would. Run by Playwright: node e2e/server.ts
import { mkdtemp } from "node:fs/promises";
import { type IncomingMessage, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../server/src/app.ts";
import { DiskBlobs } from "../../server/src/blobs.ts";
import { readConfig } from "../../server/src/config.ts";
import { migrate } from "../../server/src/migrations.ts";
import { newSetupCode } from "../../server/src/setup.ts";
import { TestMailer } from "../../server/test/app.ts";
import { testDatabase } from "../../server/test/database.ts";
import { startProvider } from "../../server/test/provider.ts";

export const port = 4175;
export const controlPort = 4176;
const url = `http://127.0.0.1:${String(port)}`;
const password = "a long password";

const provider = await startProvider();
const mailer = new TestMailer();
const db = await testDatabase();
await migrate(db);
const setupCode = newSetupCode();
const app = await buildApp(
  readConfig({
    NETHER_DATABASE_URL: "postgres://nether@localhost:5432/nether",
    NETHER_LOG_LEVEL: "warn",
    NETHER_PUBLIC_URL: url,
    NETHER_WEB_APP: fileURLToPath(new URL("../dist", import.meta.url)),
    NETHER_OIDC_ISSUER: provider.issuer,
    NETHER_OIDC_CLIENT_ID: provider.clientId,
    NETHER_OIDC_CLIENT_SECRET: provider.clientSecret,
    NETHER_OIDC_NAME: "Test SSO",
  }),
  { db, setupCode, mailer, blobs: new DiskBlobs(await mkdtemp(join(tmpdir(), "nether-web-e2e-"))) },
);
await app.listen({ host: "127.0.0.1", port });

// Ada sets the server up, with the workspace Team.
const setup = (await (
  await fetch(`${url}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: setupCode,
      name: "Ada",
      email: "ada@example.org",
      password,
      workspace: "Team",
    }),
  })
).json()) as { token: string; workspace: { id: string } };

async function api(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${setup.token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: ${String(response.status)} ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>;
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
    request.on("end", () => {
      try {
        resolve(text === "" ? {} : (JSON.parse(text) as Record<string, unknown>));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    request.on("error", reject);
  });
}

const control = createServer((request, response) => {
  void (async () => {
    try {
      const body = await readBody(request);
      let answer: unknown;
      if (request.url === "/mail") {
        answer = mailer.sent;
      } else if (request.url === "/invitation") {
        // A link to Team, for anyone, as Ada would share it.
        answer = await api(`/api/workspaces/${setup.workspace.id}/invitations`, { role: "member" });
      } else if (request.url === "/person") {
        // Someone in Team, with an account of their own.
        const name = String(body.name);
        const email = String(body.email);
        const { token } = await api(`/api/workspaces/${setup.workspace.id}/invitations`, {
          role: "member",
          email,
        });
        const accepted = await fetch(`${url}/api/invitations/accept`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, name, email, password }),
        });
        if (!accepted.ok) throw new Error(`accept: ${String(accepted.status)}`);
        answer = { email, password };
      } else if (request.url === "/provider") {
        // Who the provider signs in next, and its page: signing in at the address the popup opened.
        provider.person = {
          sub: String(body.email),
          email: String(body.email),
          email_verified: true,
        };
        answer = { location: provider.authorize(String(body.url)) };
      } else {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  })();
});
control.listen(controlPort, "127.0.0.1");

const stop = () => {
  control.close();
  void app.close().then(() => provider.close());
  void db.close();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
