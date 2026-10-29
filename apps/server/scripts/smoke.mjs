// Starts the built server (dist/main.js) with every enterprise feature
// switched off, checks that /health answers and reports them all off, then
// stops it. CI runs this after the build: `pnpm --filter @nether/server smoke`.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const features = ["SSO", "SCIM", "AUDIT", "POLICIES", "ADMIN", "HA"];
const env = {
  ...process.env,
  NETHER_HOST: "127.0.0.1",
  NETHER_PORT: "0",
  NETHER_LOG_LEVEL: "info",
};
for (const feature of features) env[`NETHER_ENTERPRISE_${feature}`] = "off";

const server = spawn(process.execPath, ["dist/main.js"], {
  cwd: new URL("..", import.meta.url),
  env,
  stdio: ["ignore", "pipe", "inherit"],
});

function finish(code, message) {
  if (message) console[code === 0 ? "log" : "error"](message);
  server.kill();
  process.exitCode = code;
}

const timer = setTimeout(() => {
  finish(1, "The server did not start listening within 15 seconds.");
}, 15_000);

server.on("exit", (code) => {
  if (process.exitCode === undefined) {
    clearTimeout(timer);
    finish(1, `The server exited early with code ${String(code)}.`);
  }
});

// Fastify logs one JSON line per event; the one that says where it listens
// gives the port it picked.
for await (const line of createInterface({ input: server.stdout })) {
  const address = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(line)?.[1];
  if (address === undefined) continue;
  clearTimeout(timer);
  try {
    const response = await fetch(`${address}/health`);
    const body = await response.json();
    const off = Object.values(body.enterprise ?? {}).every((value) => value === false);
    if (response.status !== 200 || body.status !== "ok" || !off) {
      finish(1, `Unexpected health check: ${response.status} ${JSON.stringify(body)}`);
    } else {
      finish(0, `Server ${body.version} answered at ${address} with every enterprise feature off.`);
    }
  } catch (error) {
    finish(1, `The health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  break;
}
