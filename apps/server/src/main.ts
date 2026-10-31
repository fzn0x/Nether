// Starts the server: `node dist/main.js`, configured by environment
// variables. It brings the database to its schema first, and while it has
// no account it writes the setup code to its log.
import { buildApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { connectPostgres } from "./db.ts";
import { smtpMailer } from "./mail.ts";
import { migrate } from "./migrations.ts";
import { newSetupCode, setupNeeded } from "./setup.ts";

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const db = connectPostgres(config.databaseUrl);
  try {
    const migrated = await migrate(db);
    const setupCode = (await setupNeeded(db)) ? newSetupCode() : undefined;
    const mailer = config.mail === null ? undefined : smtpMailer(config.mail.url, config.mail.from);
    const app = await buildApp(config, {
      db,
      ...(setupCode === undefined ? {} : { setupCode }),
      ...(mailer === undefined ? {} : { mailer }),
    });
    if (migrated.from !== migrated.to) {
      app.log.info(migrated, "Migrated the database to the server's schema");
    }
    app.addHook("onClose", async () => {
      mailer?.close();
      await db.close();
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        app.log.info(`Received ${signal}, shutting down`);
        void app.close().then(() => process.exit(0));
      });
    }
    await app.listen({ host: config.host, port: config.port });
    if (setupCode !== undefined) {
      app.log.warn(
        { setupCode },
        `The server has no account yet. Set it up from the app with this code: ${setupCode}`,
      );
    }
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Nether server could not start: ${message}\n`);
  process.exit(1);
});
