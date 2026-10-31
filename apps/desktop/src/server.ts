// Talking to a Nether server (ADR 0036): its address as someone types it,
// the ways it offers to sign in, and signing in with a password, a code it
// emails, or its OpenID Connect provider. Requests go through the
// backend's fetch: Go makes them in the desktop app, so the page's CORS
// does not apply, and the browser does in the preview.
import { type MessageKey, t } from "./messages.ts";

/** The account signed in to a server as. */
export interface ServerUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly instanceAdmin: boolean;
}

export interface SignedIn {
  readonly token: string;
  readonly user: ServerUser;
}

export interface SignInMethods {
  readonly password: boolean;
  readonly emailCode: boolean;
  /** The provider's name, when the server signs in with one. */
  readonly oidc: { readonly name: string } | null;
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  /** Whether its members' apps encrypt it, so the server cannot read it (ADR 0038). */
  readonly encrypted: boolean;
}

/** Where the browser comes back to after a provider, and the wait for it. */
export interface LoopbackWait {
  readonly redirect: string;
  /** The query the browser comes back with, as its `code` or `error`. */
  wait(): Promise<Readonly<Record<string, string>>>;
  close(): Promise<void>;
}

type Fetch = typeof fetch;

/** A server's answer that is not a success, with the message it gave. */
export class ServerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ServerError";
    this.status = status;
  }
}

/**
 * A server's address from what someone typed: https:// when they gave no
 * scheme, without a path; undefined when it is not one.
 */
export function serverAddress(typed: string): string | undefined {
  const text = typed.trim();
  if (text === "") return undefined;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname.replace(/\/+$/, "") !== ""
  ) {
    return undefined;
  }
  return url.origin;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** A text of a server's answer; it throws when the answer has none there. */
function text(value: unknown, base: string): string {
  if (typeof value !== "string") throw new ServerError(0, t("serverOddAnswer", { server: base }));
  return value;
}

/** Sends a request to a server and gives its answer's JSON, or throws a ServerError. */
export async function request(
  fetcher: Fetch,
  base: string,
  path: string,
  options: { readonly method?: string; readonly body?: unknown; readonly token?: string } = {},
): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  let response: Response;
  try {
    response = await fetcher(base + path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ServerError(0, t("serverUnreachable", { server: base, reason }));
  }
  if (response.status === 204) return undefined;
  const answer: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = record(answer).message;
    throw new ServerError(
      response.status,
      typeof message === "string"
        ? message
        : t("serverAnswered", { server: base, status: response.status }),
    );
  }
  return answer;
}

function userOf(answer: unknown, base: string): ServerUser {
  const user = record(answer);
  return {
    id: text(user.id, base),
    name: text(user.name, base),
    email: text(user.email, base),
    instanceAdmin: user.instanceAdmin === true,
  };
}

function signedIn(answer: unknown, base: string): SignedIn {
  const body = record(answer);
  return { token: text(body.token, base), user: userOf(body.user, base) };
}

/** How a server offers to sign in; it throws when the address is not a Nether server's. */
export async function signInMethods(fetcher: Fetch, base: string): Promise<SignInMethods> {
  const answer = record(await request(fetcher, base, "/api/sign-in-methods"));
  if (typeof answer.password !== "boolean") {
    throw new ServerError(0, t("notNetherServer", { server: base }));
  }
  const oidc = record(answer.oidc);
  return {
    password: answer.password,
    emailCode: answer.emailCode === true,
    oidc: typeof oidc.name === "string" ? { name: oidc.name } : null,
  };
}

export async function signInWithPassword(
  fetcher: Fetch,
  base: string,
  email: string,
  password: string,
): Promise<SignedIn> {
  return signedIn(
    await request(fetcher, base, "/api/sessions", { body: { email: email.trim(), password } }),
    base,
  );
}

/** Asks the server to email a code to sign in with. */
export async function askForCode(fetcher: Fetch, base: string, email: string): Promise<void> {
  await request(fetcher, base, "/api/sign-in-codes", { body: { email: email.trim() } });
}

export async function redeemCode(
  fetcher: Fetch,
  base: string,
  email: string,
  code: string,
): Promise<SignedIn> {
  return signedIn(
    await request(fetcher, base, "/api/sign-in-codes/redeem", {
      body: { email: email.trim(), code },
    }),
    base,
  );
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A PKCE verifier, and its S256 challenge (RFC 7636). */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** Why a sign-in with a provider failed, by the error the server sent back. */
const providerErrors: Readonly<Record<string, MessageKey>> = {
  access_denied: "providerCancelled",
  no_account: "providerNoAccount",
  email_not_verified: "providerUnverified",
  invitation: "providerInvitation",
  other_address: "providerOtherAddress",
  provider_error: "providerFailed",
};

/**
 * Signs in with the server's provider, as RFC 8252 has an app do: the
 * system's browser signs in at the provider, comes back to the app's
 * loopback address with a code, which the app redeems with its verifier.
 */
export async function signInWithProvider(
  fetcher: Fetch,
  base: string,
  loopback: LoopbackWait,
  openUrl: (url: string) => Promise<void>,
): Promise<SignedIn> {
  try {
    const { verifier, challenge } = await pkce();
    const flow = record(
      await request(fetcher, base, "/api/oidc/flows", {
        body: { redirect: loopback.redirect, challenge },
      }),
    );
    await openUrl(text(flow.url, base));
    const query = await loopback.wait();
    const error = query.error;
    if (error !== undefined) {
      const key = providerErrors[error];
      throw new ServerError(401, key === undefined ? t("providerUnknown", { error }) : t(key));
    }
    return signedIn(
      await request(fetcher, base, "/api/oidc/redeem", {
        body: { code: query.code ?? "", verifier },
      }),
      base,
    );
  } finally {
    await loopback.close();
  }
}

/** The account a token signs in, and the workspaces it is in. */
export async function account(
  fetcher: Fetch,
  base: string,
  token: string,
): Promise<{ user: ServerUser; workspaces: Workspace[] }> {
  const answer = record(await request(fetcher, base, "/api/me", { token }));
  const workspaces = Array.isArray(answer.workspaces) ? (answer.workspaces as unknown[]) : [];
  return {
    user: userOf(answer.user, base),
    workspaces: workspaces.map((item) => {
      const workspace = record(item);
      return {
        id: text(workspace.id, base),
        name: text(workspace.name, base),
        role: text(workspace.role, base),
        encrypted: workspace.encryption === "end-to-end",
      };
    }),
  };
}

/** Signs a session out on the server; the app forgets its token either way. */
export async function signOut(fetcher: Fetch, base: string, token: string): Promise<void> {
  await request(fetcher, base, "/api/sessions/current", { method: "DELETE", token });
}

/** An account's keys for encrypted workspaces, as the server keeps them, in base64. */
export interface AccountKeys {
  readonly publicKey: string;
  /** The private key, in a box only the account's recovery phrase opens. */
  readonly recoveryBox: string;
}

/** The account's keys on the server; undefined when it has none yet. */
export async function accountKeys(
  fetcher: Fetch,
  base: string,
  token: string,
): Promise<AccountKeys | undefined> {
  try {
    const answer = record(await request(fetcher, base, "/api/me/keys", { token }));
    return { publicKey: text(answer.publicKey, base), recoveryBox: text(answer.recoveryBox, base) };
  } catch (error) {
    if (error instanceof ServerError && error.status === 404) return undefined;
    throw error;
  }
}

export async function saveAccountKeys(
  fetcher: Fetch,
  base: string,
  token: string,
  keys: AccountKeys,
): Promise<void> {
  await request(fetcher, base, "/api/me/keys", { method: "PUT", token, body: keys });
}

/** Makes a workspace the account owns: encrypted when given its key sealed to its maker. */
export async function makeWorkspace(
  fetcher: Fetch,
  base: string,
  token: string,
  name: string,
  sealedKey?: string,
): Promise<Workspace> {
  const answer = record(
    await request(fetcher, base, "/api/workspaces", {
      token,
      body: sealedKey === undefined ? { name } : { name, encryption: "end-to-end", sealedKey },
    }),
  );
  return {
    id: text(answer.id, base),
    name: text(answer.name, base),
    role: text(answer.role, base),
    encrypted: answer.encryption === "end-to-end",
  };
}

/** The account's sealed copy of an encrypted workspace's key; undefined while no member has sealed one. */
export async function sealedWorkspaceKey(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
): Promise<{ version: number; sealedKey: string } | undefined> {
  try {
    const answer = record(
      await request(fetcher, base, `/api/workspaces/${workspaceId}/key`, { token }),
    );
    const version = answer.version;
    if (typeof version !== "number") return undefined;
    return { version, sealedKey: text(answer.sealedKey, base) };
  } catch (error) {
    if (error instanceof ServerError && error.status === 404) return undefined;
    throw error;
  }
}

/** The members of an encrypted workspace waiting for its key, with their public keys. */
export async function keylessMembers(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
): Promise<{ userId: string; publicKey: string; version: number }[]> {
  const answer = record(
    await request(fetcher, base, `/api/workspaces/${workspaceId}/keyless`, { token }),
  );
  const members = Array.isArray(answer.members) ? (answer.members as unknown[]) : [];
  return members.map((item) => {
    const member = record(item);
    return {
      userId: text(member.userId, base),
      publicKey: text(member.publicKey, base),
      version: typeof member.version === "number" ? member.version : 1,
    };
  });
}

/** Gives a member the workspace's key, sealed to their public key. */
export async function sealForMember(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  userId: string,
  sealed: { version: number; sealedKey: string },
): Promise<void> {
  await request(fetcher, base, `/api/workspaces/${workspaceId}/keys/${userId}`, {
    method: "PUT",
    token,
    body: sealed,
  });
}
