// Starts the server: `node dist/main.js`, configured by environment variables.
import { buildApp } from "./app.ts";
import { readConfig } from "./config.ts";

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const app = await buildApp(config);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      app.log.info(`Received ${signal}, shutting down`);
      void app.close().then(() => process.exit(0));
    });
  }
  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Nether server could not start: ${message}\n`);
  process.exit(1);
});
