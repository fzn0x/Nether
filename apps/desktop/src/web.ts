// What every build knows of the web app (ADR 0053), kept apart from its
// backend (webBackend.ts), which only the web app's build loads: the server
// that serves the page, the page a provider sends the browser back to,
// fetch with the session's cookie, and the account and its workspaces as
// this browser last knew them, so the app opens offline.
import type { ServerAccount } from "./mygo.ts";
import { ServerError, type Workspace, account } from "./server.ts";

/** The server the page is served by, which is the only one it talks to. */
export const webServer = location.origin;

/** The page a provider sends the browser back to, and the channel it hands the query over by. */
export const providerReturn = "/sign-in/provider";
export const providerChannel = "nether-provider";

/** A cookie the page may read, by name. */
function cookie(name: string): string | undefined {
  for (const part of document.cookie.split(";")) {
    const at = part.indexOf("=");
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return undefined;
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * fetch for the server, with the session's cookie: an empty bearer token,
 * which stands for it, is left out, sign-ins ask for the cookie, and
 * requests that change anything send the CSRF value back.
 */
export const webFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (/^Bearer\s*$/i.test(headers.get("authorization") ?? "x")) headers.delete("authorization");
  headers.set("x-nether-session", "cookie");
  const method = (init?.method ?? "GET").toUpperCase();
  const csrf = cookie("nether_csrf");
  if (!safeMethods.has(method) && csrf !== undefined) headers.set("x-nether-csrf", csrf);
  return fetch(input, { ...init, headers, credentials: "same-origin" });
};

const accountKey = "nether.web.account";
const workspacesKey = "nether.web.workspaces";
/** Where the account's private key for encrypted workspaces is kept, by the account's ID. */
export const keyPrefix = "nether.web.key.";

export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage that is refused, as in a private window, keeps nothing.
  }
}

/** The account signed in, as this browser last knew it. */
export function signedInAccount(): ServerAccount | undefined {
  const text = stored(accountKey);
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as Partial<ServerAccount>;
    return value.url === webServer && typeof value.user?.id === "string"
      ? (value as ServerAccount)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the account signed in to this server. */
export function keepAccount(signedIn: ServerAccount): void {
  if (signedIn.url === webServer) store(accountKey, JSON.stringify(signedIn));
}

/** Forgets the account, its workspaces and its private key, as signing out does. */
export function forgetAccount(): void {
  const signedIn = signedInAccount();
  if (signedIn !== undefined) store(keyPrefix + signedIn.user.id, undefined);
  store(accountKey, undefined);
  store(workspacesKey, undefined);
}

function keptWorkspaces(): Workspace[] | undefined {
  const text = stored(workspacesKey);
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? (value as Workspace[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The account's workspaces: from the server, and kept for when it cannot
 * be reached, when the ones kept are given, `offline`. None when signed
 * out; a session the server ended is forgotten.
 */
export async function webWorkspaces(): Promise<{ workspaces: Workspace[]; offline: boolean }> {
  if (signedInAccount() === undefined) return { workspaces: [], offline: false };
  try {
    const { workspaces } = await account(webFetch, webServer, "");
    store(workspacesKey, JSON.stringify(workspaces));
    return { workspaces, offline: false };
  } catch (error) {
    if (error instanceof ServerError && error.status === 401) forgetAccount();
    const kept = error instanceof ServerError && error.status === 0 ? keptWorkspaces() : undefined;
    if (kept === undefined) throw error;
    return { workspaces: kept, offline: true };
  }
}
