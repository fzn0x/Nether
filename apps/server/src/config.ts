// The server's configuration, read from environment variables.
import { isIP } from "node:net";
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
  /**
   * Which proxies in front of the server to believe about the client's
   * address: none, all, or their addresses and ranges.
   */
  readonly trustProxy: boolean | readonly string[];
  /** The SMTP server to send email through, if any; without one the server sends none. */
  readonly mail: MailConfig | null;
  /**
   * The address people reach the server at, as `https://nether.example.org`,
   * without a slash at its end, for the links and redirects that need it.
   */
  readonly publicUrl: string | null;
  /** The OpenID Connect provider to sign in with, if any. */
  readonly oidc: OidcConfig | null;
  readonly enterprise: EnterpriseSwitches;
}

export interface MailConfig {
  /** As `smtp://user:password@host:587` or `smtps://user:password@host:465`. */
  readonly url: string;
  /** The sender, as `Nether <nether@example.org>`. */
  readonly from: string;
}

export interface OidcConfig {
  /** The provider's issuer, whose discovery document is under `/.well-known/openid-configuration`. */
  readonly issuer: string;
  readonly clientId: string;
  /** None for a public client, which proves itself with PKCE alone. */
  readonly clientSecret: string | null;
  /** The provider's name, for the app's button: "Sign in with …". */
  readonly name: string;
  /** Whether anyone the provider signs in gets an account, not only people with one or an invitation. */
  readonly signUp: boolean;
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

/** An address, a range in CIDR notation, or one of proxy-addr's named ranges. */
function isProxy(text: string): boolean {
  if (["loopback", "linklocal", "uniquelocal"].includes(text)) return true;
  const [address = "", bits, ...rest] = text.split("/");
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return false;
  return bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= (version === 4 ? 32 : 128));
}

function readTrustProxy(env: NodeJS.ProcessEnv): boolean | readonly string[] {
  const value = env.NETHER_TRUST_PROXY?.trim() ?? "";
  if (off.includes(value.toLowerCase())) return false;
  if (on.includes(value.toLowerCase())) return true;
  const proxies = value.split(",").map((item) => item.trim());
  if (!proxies.every(isProxy)) {
    throw new ConfigError(
      "NETHER_TRUST_PROXY",
      `must be on, off, or the proxies' addresses and ranges separated by commas, not "${value}"`,
    );
  }
  return proxies;
}

function readMail(env: NodeJS.ProcessEnv): MailConfig | null {
  const url = env.NETHER_SMTP_URL?.trim() ?? "";
  const from = env.NETHER_MAIL_FROM?.trim() ?? "";
  if (url === "") {
    if (from !== "") {
      throw new ConfigError(
        "NETHER_MAIL_FROM",
        "is set without NETHER_SMTP_URL: set both to send email",
      );
    }
    return null;
  }
  if (!/^smtps?:\/\//i.test(url)) {
    throw new ConfigError("NETHER_SMTP_URL", "must be an smtp:// or smtps:// address");
  }
  if (!/^[^@\s]+@[^@\s]+$|<[^@\s]+@[^@\s]+>$/.test(from)) {
    throw new ConfigError(
      "NETHER_MAIL_FROM",
      "must be the address email comes from, as Nether <nether@example.org>",
    );
  }
  return { url, from };
}

/** An http:// or https:// address without a query or fragment, without its last slash. */
function readHttpUrl(env: NodeJS.ProcessEnv, variable: string): string | null {
  const value = env[variable]?.trim() ?? "";
  if (value === "") return null;
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (
    url === undefined ||
    !["http:", "https:"].includes(url.protocol) ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new ConfigError(variable, `must be an http:// or https:// address, not "${value}"`);
  }
  return value.replace(/\/+$/, "");
}

const oidcVariables = [
  "NETHER_OIDC_ISSUER",
  "NETHER_OIDC_CLIENT_ID",
  "NETHER_OIDC_CLIENT_SECRET",
  "NETHER_OIDC_NAME",
  "NETHER_OIDC_SIGN_UP",
];

function readOidc(env: NodeJS.ProcessEnv, publicUrl: string | null): OidcConfig | null {
  const issuer = readHttpUrl(env, "NETHER_OIDC_ISSUER");
  if (issuer === null) {
    const stray = oidcVariables.find((variable) => (env[variable]?.trim() ?? "") !== "");
    if (stray !== undefined) {
      throw new ConfigError(
        stray,
        "is set without NETHER_OIDC_ISSUER: set it to sign in with OIDC",
      );
    }
    return null;
  }
  const clientId = env.NETHER_OIDC_CLIENT_ID?.trim() ?? "";
  if (clientId === "") {
    throw new ConfigError("NETHER_OIDC_CLIENT_ID", "must be set with NETHER_OIDC_ISSUER");
  }
  if (publicUrl === null) {
    throw new ConfigError(
      "NETHER_PUBLIC_URL",
      "must be set with NETHER_OIDC_ISSUER, for the provider to send people back to",
    );
  }
  const secret = env.NETHER_OIDC_CLIENT_SECRET?.trim() ?? "";
  const name = env.NETHER_OIDC_NAME?.trim() ?? "";
  return {
    issuer,
    clientId,
    clientSecret: secret === "" ? null : secret,
    name: name === "" ? "single sign-on" : name,
    signUp: readSwitch(env, "NETHER_OIDC_SIGN_UP"),
  };
}

/** Reads the configuration, throwing a ConfigError that names the variable at fault. */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const enterprise = Object.fromEntries(
    enterpriseFeatures.map((feature) => [feature, readSwitch(env, switchVariable(feature))]),
  ) as Record<keyof EnterpriseSwitches, boolean>;
  const host = env.NETHER_HOST?.trim() ?? "";
  const publicUrl = readHttpUrl(env, "NETHER_PUBLIC_URL");
  return {
    host: host === "" ? "127.0.0.1" : host,
    port: readPort(env),
    logLevel: readLogLevel(env),
    databaseUrl: readDatabaseUrl(env),
    trustProxy: readTrustProxy(env),
    mail: readMail(env),
    publicUrl,
    oidc: readOidc(env, publicUrl),
    enterprise,
  };
}
