// The server's configuration, read from environment variables.
import { type EnterpriseSwitches, enterpriseFeatures, switchVariable } from "./enterprise.ts";

export const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof logLevels)[number];

export interface Config {
  /** The address to listen on. The Docker image sets 0.0.0.0. */
  readonly host: string;
  /** The port to listen on; 0 picks a free one. */
  readonly port: number;
  readonly logLevel: LogLevel;
  /** The PostgreSQL database's address, as `postgres://user:password@host:5432/nether`. */
  readonly databaseUrl: string;
  readonly enterprise: EnterpriseSwitches;
}

/** A configuration value that cannot be used, with the variable that holds it. */
export class ConfigError extends Error {
  constructor(variable: string, problem: string) {
    super(`${variable} ${problem}`);
    this.name = "ConfigError";
  }
}

const on = ["on", "true", "yes", "1"];
const off = ["off", "false", "no", "0", ""];

function readSwitch(env: NodeJS.ProcessEnv, variable: string): boolean {
  const value = (env[variable] ?? "").trim().toLowerCase();
  if (on.includes(value)) return true;
  if (off.includes(value)) return false;
  throw new ConfigError(variable, `must be on or off, not "${env[variable] ?? ""}"`);
}

function readPort(env: NodeJS.ProcessEnv): number {
  const value = env.NETHER_PORT?.trim() ?? "";
  if (value === "") return 3000;
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) {
    throw new ConfigError("NETHER_PORT", `must be a port number from 0 to 65535, not "${value}"`);
  }
  return port;
}

function readLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const value = env.NETHER_LOG_LEVEL?.trim().toLowerCase() ?? "";
  if (value === "") return "info";
  const level = logLevels.find((item) => item === value);
  if (level === undefined) {
    throw new ConfigError(
      "NETHER_LOG_LEVEL",
      `must be one of ${logLevels.join(", ")}, not "${value}"`,
    );
  }
  return level;
}

function readDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const value = env.NETHER_DATABASE_URL?.trim() ?? "";
  if (value === "") {
    throw new ConfigError(
      "NETHER_DATABASE_URL",
      "must be set to the PostgreSQL database's address, as postgres://user:password@host:5432/nether",
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    throw new ConfigError("NETHER_DATABASE_URL", "must be a postgres:// address");
  }
  return value;
}

/** Reads the configuration, throwing a ConfigError that names the variable at fault. */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const enterprise = Object.fromEntries(
    enterpriseFeatures.map((feature) => [feature, readSwitch(env, switchVariable(feature))]),
  ) as Record<keyof EnterpriseSwitches, boolean>;
  const host = env.NETHER_HOST?.trim() ?? "";
  return {
    host: host === "" ? "127.0.0.1" : host,
    port: readPort(env),
    logLevel: readLogLevel(env),
    databaseUrl: readDatabaseUrl(env),
    enterprise,
  };
}
