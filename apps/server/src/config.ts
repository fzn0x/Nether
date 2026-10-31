// The server's configuration, read from environment variables.
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
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
  /** Where attachments' bytes are kept: a folder on the server's disk, or an S3-compatible bucket. */
  readonly storage: StorageConfig;
  /** The largest attachment the server takes, in bytes. */
  readonly attachmentLimit: number;
  /** How many days the server keeps notes' earlier versions (ADR 0041). */
  readonly historyDays: number;
  /** Scheduled backups (ADR 0052), or none. */
  readonly backup: BackupConfig | null;
  /** The web app's build to serve at `/` (ADR 0053), or none. */
  readonly webApp: WebAppConfig | null;
  readonly enterprise: EnterpriseSwitches;
}

export interface WebAppConfig {
  /** The folder of the web app's build, with its index.html. */
  readonly dir: string;
  /** Whether NETHER_WEB_APP named it, so the server must serve it, rather than finding it there. */
  readonly named: boolean;
}

export interface MailConfig {
  /** As `smtp://user:password@host:587` or `smtps://user:password@host:465`. */
  readonly url: string;
  /** The sender, as `Nether <nether@example.org>`. */
  readonly from: string;
}

export type StorageConfig =
  | { readonly kind: "disk"; readonly path: string }
  | {
      readonly kind: "s3";
      readonly endpoint: string;
      readonly bucket: string;
      readonly region: string;
      readonly accessKey: string;
      readonly secretKey: string;
    };

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

function readStorage(env: NodeJS.ProcessEnv): StorageConfig {
  const kind = (env.NETHER_STORAGE?.trim() ?? "").toLowerCase();
  if (kind === "" || kind === "disk") {
    const path = env.NETHER_STORAGE_PATH?.trim() ?? "";
    return { kind: "disk", path: path === "" ? "data/attachments" : path };
  }
  if (kind !== "s3") {
    throw new ConfigError("NETHER_STORAGE", `must be disk or s3, not "${kind}"`);
  }
  const endpoint = readHttpUrl(env, "NETHER_S3_ENDPOINT");
  if (endpoint === null) {
    throw new ConfigError("NETHER_S3_ENDPOINT", "must be set to the S3-compatible store's address");
  }
  const required = (variable: string): string => {
    const value = env[variable]?.trim() ?? "";
    if (value === "") throw new ConfigError(variable, "must be set when NETHER_STORAGE is s3");
    return value;
  };
  const region = env.NETHER_S3_REGION?.trim() ?? "";
  return {
    kind: "s3",
    endpoint,
    bucket: required("NETHER_S3_BUCKET"),
    region: region === "" ? "us-east-1" : region,
    accessKey: required("NETHER_S3_ACCESS_KEY"),
    secretKey: required("NETHER_S3_SECRET_KEY"),
  };
}

function readAttachmentLimit(env: NodeJS.ProcessEnv): number {
  const value = env.NETHER_ATTACHMENT_LIMIT?.trim() ?? "";
  if (value === "") return 100 * 1024 * 1024;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 4096) {
    throw new ConfigError(
      "NETHER_ATTACHMENT_LIMIT",
      `must be a number of mebibytes from 1 to 4096, not "${value}"`,
    );
  }
  return Number(value) * 1024 * 1024;
}

/** Where scheduled backups go, how often, and how many are kept. */
export interface BackupConfig {
  readonly target:
    | { readonly kind: "disk"; readonly path: string }
    | {
        readonly kind: "s3";
        readonly endpoint: string;
        readonly bucket: string;
        readonly region: string;
        readonly accessKey: string;
        readonly secretKey: string;
        /** The folder of the bucket the backups go in, ending with a slash. */
        readonly prefix: string;
      };
  readonly hours: number;
  readonly keep: number;
}

function readCount(
  env: NodeJS.ProcessEnv,
  variable: string,
  fallback: number,
  max: number,
): number {
  const value = env[variable]?.trim() ?? "";
  if (value === "") return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new ConfigError(
      variable,
      `must be a whole number from 1 to ${String(max)}, not "${value}"`,
    );
  }
  return Number(value);
}

function readBackup(env: NodeJS.ProcessEnv): BackupConfig | null {
  const kind = (env.NETHER_BACKUP?.trim() ?? "").toLowerCase();
  if (kind === "" || kind === "off") return null;
  const hours = readCount(env, "NETHER_BACKUP_HOURS", 24, 8760);
  const keep = readCount(env, "NETHER_BACKUP_KEEP", 7, 1000);
  if (kind === "disk") {
    const path = env.NETHER_BACKUP_PATH?.trim() ?? "";
    return { target: { kind: "disk", path: path === "" ? "data/backups" : path }, hours, keep };
  }
  if (kind !== "s3") {
    throw new ConfigError("NETHER_BACKUP", `must be off, disk or s3, not "${kind}"`);
  }
  const endpoint = readHttpUrl(env, "NETHER_S3_ENDPOINT");
  if (endpoint === null) {
    throw new ConfigError("NETHER_S3_ENDPOINT", "must be set when NETHER_BACKUP is s3");
  }
  const required = (variable: string): string => {
    const value = env[variable]?.trim() ?? "";
    if (value === "") throw new ConfigError(variable, "must be set when NETHER_BACKUP is s3");
    return value;
  };
  const region = env.NETHER_S3_REGION?.trim() ?? "";
  const prefix = (env.NETHER_BACKUP_S3_PREFIX?.trim() ?? "").replace(/^\/+/, "");
  return {
    target: {
      kind: "s3",
      endpoint,
      bucket: required("NETHER_BACKUP_S3_BUCKET"),
      region: region === "" ? "us-east-1" : region,
      accessKey: required("NETHER_S3_ACCESS_KEY"),
      secretKey: required("NETHER_S3_SECRET_KEY"),
      prefix: prefix === "" ? "nether-backups/" : prefix.endsWith("/") ? prefix : `${prefix}/`,
    },
    hours,
    keep,
  };
}

function readHistoryDays(env: NodeJS.ProcessEnv): number {
  const value = env.NETHER_HISTORY_DAYS?.trim() ?? "";
  if (value === "") return 30;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 36_500) {
    throw new ConfigError(
      "NETHER_HISTORY_DAYS",
      `must be a number of days from 1 to 36500, not "${value}"`,
    );
  }
  return Number(value);
}

/** Where the web app is built, beside the server in the repository: apps/web/dist. */
export const builtWebApp = fileURLToPath(new URL("../../web/dist", import.meta.url));

/**
 * The web app to serve: the folder NETHER_WEB_APP names, none for "off",
 * and by default the one built beside the server, if it was built.
 */
function readWebApp(env: NodeJS.ProcessEnv): WebAppConfig | null {
  const value = env.NETHER_WEB_APP?.trim() ?? "";
  if (value.toLowerCase() === "off") return null;
  return value === "" ? { dir: builtWebApp, named: false } : { dir: value, named: true };
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
    storage: readStorage(env),
    attachmentLimit: readAttachmentLimit(env),
    historyDays: readHistoryDays(env),
    backup: readBackup(env),
    webApp: readWebApp(env),
    enterprise,
  };
}
