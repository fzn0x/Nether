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

/** The versions a server keeps of a note, the latest first (ADR 0041). */
export async function noteVersions(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  note: string,
): Promise<{ id: string; time: number }[]> {
  const path = `/api/workspaces/${workspaceId}/documents/${note}/versions`;
  const answer = record(await request(fetcher, base, path, { token }));
  const versions = Array.isArray(answer.versions) ? (answer.versions as unknown[]) : [];
  return versions.map((item) => {
    const version = record(item);
    const time = Date.parse(text(version.time, base));
    if (Number.isNaN(time)) throw new ServerError(0, t("serverOddAnswer", { server: base }));
    return { id: text(version.id, base), time };
  });
}

/** One of a note's versions on a server, as the Yjs state it was. */
export async function noteVersionState(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  note: string,
  version: string,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetcher(
      `${base}/api/workspaces/${workspaceId}/documents/${note}/versions/${version}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ServerError(0, t("serverUnreachable", { server: base, reason }));
  }
  if (!response.ok) {
    throw new ServerError(
      response.status,
      t("serverAnswered", { server: base, status: response.status }),
    );
  }
  return new Uint8Array(await response.arrayBuffer());
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

/** A workspace's member, as its owners and admins manage them. */
export interface Member {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
}

/** A workspace's members, by name; a guest is refused the list. */
export async function members(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
): Promise<Member[]> {
  const answer = record(
    await request(fetcher, base, `/api/workspaces/${workspaceId}/members`, { token }),
  );
  const list = Array.isArray(answer.members) ? (answer.members as unknown[]) : [];
  return list.map((item) => {
    const member = record(item);
    return {
      id: text(member.id, base),
      name: text(member.name, base),
      email: text(member.email, base),
      role: text(member.role, base),
    };
  });
}

/** Changes a member's role, as an owner or admin may. */
export async function setMemberRole(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  userId: string,
  role: string,
): Promise<void> {
  await request(fetcher, base, `/api/workspaces/${workspaceId}/members/${userId}`, {
    method: "PATCH",
    token,
    body: { role },
  });
}

/** Removes a member, or, given the account's own ID, leaves the workspace. */
export async function removeMember(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await request(fetcher, base, `/api/workspaces/${workspaceId}/members/${userId}`, {
    method: "DELETE",
    token,
  });
}

/** An invitation waiting to be accepted. */
export interface Invitation {
  readonly id: string;
  readonly role: string;
  /** The address it is for; none when anyone with its link may accept it. */
  readonly email: string | null;
  readonly expiresAt: string;
}

/** Invites someone to a workspace; gives the invitation and the token its link carries. */
export async function invite(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  role: string,
  email: string,
): Promise<Invitation & { readonly token: string }> {
  const answer = record(
    await request(fetcher, base, `/api/workspaces/${workspaceId}/invitations`, {
      token,
      body: email.trim() === "" ? { role } : { role, email: email.trim() },
    }),
  );
  return { ...invitationOf(answer, base), token: text(answer.token, base) };
}

function invitationOf(value: unknown, base: string): Invitation {
  const invitation = record(value);
  return {
    id: text(invitation.id, base),
    role: text(invitation.role, base),
    email: typeof invitation.email === "string" ? invitation.email : null,
    expiresAt: text(invitation.expiresAt, base),
  };
}

/** A workspace's invitations still waiting. */
export async function invitations(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
): Promise<Invitation[]> {
  const answer = record(
    await request(fetcher, base, `/api/workspaces/${workspaceId}/invitations`, { token }),
  );
  const list = Array.isArray(answer.invitations) ? (answer.invitations as unknown[]) : [];
  return list.map((item) => invitationOf(item, base));
}

/** Withdraws an invitation, so its link no longer works. */
export async function withdrawInvitation(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await request(fetcher, base, `/api/workspaces/${workspaceId}/invitations/${invitationId}`, {
    method: "DELETE",
    token,
  });
}

/**
 * An invitation's link: the server's address and `/invite`, its token after
 * the `#`, which browsers never send to a server, so no log keeps it.
 */
export function invitationLink(server: string, token: string): string {
  return `${server}/invite#${token}`;
}

/** The server and token of an invitation's link; undefined when the text is not one. */
export function readInvitationLink(
  link: string,
): { readonly server: string; readonly token: string } | undefined {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return undefined;
  }
  const token = url.hash.slice(1);
  const server = serverAddress(url.origin);
  if (
    server === undefined ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname.replace(/\/+$/, "") !== "/invite" ||
    token === ""
  ) {
    return undefined;
  }
  return { server, token };
}

/** What an invitation is to, before it is accepted. */
export interface InvitationOffer {
  readonly workspace: { readonly id: string; readonly name: string };
  readonly role: string;
  readonly email: string | null;
  readonly invitedBy: string | null;
}

export async function lookUpInvitation(
  fetcher: Fetch,
  base: string,
  invitationToken: string,
): Promise<InvitationOffer> {
  const answer = record(
    await request(fetcher, base, "/api/invitations/lookup", { body: { token: invitationToken } }),
  );
  const workspace = record(answer.workspace);
  return {
    workspace: { id: text(workspace.id, base), name: text(workspace.name, base) },
    role: text(answer.role, base),
    email: typeof answer.email === "string" ? answer.email : null,
    invitedBy: typeof answer.invitedBy === "string" ? answer.invitedBy : null,
  };
}

/**
 * Accepts an invitation: into the account a session signs in, or into a new
 * account, which it then signs in to.
 */
export async function acceptInvitation(
  fetcher: Fetch,
  base: string,
  invitationToken: string,
  as:
    | { readonly session: string }
    | { readonly name: string; readonly email: string; readonly password: string },
): Promise<SignedIn | undefined> {
  const answer = record(
    await request(fetcher, base, "/api/invitations/accept", {
      ...("session" in as ? { token: as.session } : {}),
      body: "session" in as ? { token: invitationToken } : { token: invitationToken, ...as },
    }),
  );
  return "session" in as ? undefined : signedIn(answer, base);
}

/** A role's name as people read it; one this app does not know, as the server gave it. */
export function roleName(role: string): string {
  switch (role) {
    case "owner":
      return t("role_owner");
    case "admin":
      return t("role_admin");
    case "member":
      return t("role_member");
    case "guest":
      return t("role_guest");
    default:
      return role;
  }
}

/** A unit the account opens (ADR 0042): General, a teamspace, its private space or a shared page. */
export interface ServerUnit {
  readonly id: string;
  readonly kind: "general" | "team" | "private" | "page";
  readonly level: string;
  readonly name: string | null;
  readonly rootNote: string | null;
  readonly restricted: boolean;
}

/** The units the account opens in a workspace. */
export async function units(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
): Promise<ServerUnit[]> {
  const answer = record(
    await request(fetcher, base, `/api/workspaces/${workspaceId}/units`, { token }),
  );
  const list = Array.isArray(answer.units) ? (answer.units as unknown[]) : [];
  return list.map((item) => {
    const unit = record(item);
    const kind = text(unit.kind, base);
    return {
      id: text(unit.id, base),
      kind: kind === "team" || kind === "private" || kind === "page" ? kind : "general",
      level: text(unit.level, base),
      name: typeof unit.name === "string" ? unit.name : null,
      rootNote: typeof unit.rootNote === "string" ? unit.rootNote : null,
      restricted: unit.restricted === true,
    };
  });
}

/** Who opens a unit by a grant of their own, and the invitations to it still waiting. */
export interface UnitAccess {
  readonly restricted: boolean;
  readonly grants: readonly {
    readonly user: string;
    readonly name: string;
    readonly email: string;
    readonly level: string;
  }[];
  readonly invitations: readonly Invitation[];
}

export async function unitAccess(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  unit: string,
): Promise<UnitAccess> {
  const answer = record(
    await request(fetcher, base, `/api/workspaces/${workspaceId}/units/${unit}/grants`, { token }),
  );
  const grants = Array.isArray(answer.grants) ? (answer.grants as unknown[]) : [];
  const waiting = Array.isArray(answer.invitations) ? (answer.invitations as unknown[]) : [];
  return {
    restricted: answer.restricted === true,
    grants: grants.map((item) => {
      const grant = record(item);
      return {
        user: text(grant.user, base),
        name: text(grant.name, base),
        email: text(grant.email, base),
        level: text(grant.level, base),
      };
    }),
    invitations: waiting.map((item) => {
      const invitation = record(item);
      return {
        id: text(invitation.id, base),
        role: "guest",
        email: typeof invitation.email === "string" ? invitation.email : null,
        expiresAt: text(invitation.expiresAt, base),
      };
    }),
  };
}

/** Sends a request to a workspace's API, as `request` does, with its path after the workspace. */
function workspaceRequest(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  path: string,
  options: { readonly method?: string; readonly body?: unknown } = {},
): Promise<unknown> {
  return request(fetcher, base, `/api/workspaces/${workspaceId}${path}`, { ...options, token });
}

/** Makes a teamspace; its folder takes its name. */
export async function makeTeamspace(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  name: string,
): Promise<string> {
  const answer = record(
    await workspaceRequest(fetcher, base, token, workspaceId, "/teamspaces", { body: { name } }),
  );
  return text(answer.id, base);
}

export async function renameTeamspace(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  unit: string,
  name: string,
): Promise<void> {
  await workspaceRequest(fetcher, base, token, workspaceId, `/teamspaces/${unit}`, {
    method: "PATCH",
    body: { name },
  });
}

export async function deleteTeamspace(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  unit: string,
): Promise<void> {
  await workspaceRequest(fetcher, base, token, workspaceId, `/teamspaces/${unit}`, {
    method: "DELETE",
  });
}

/** Makes the account's private space, the first time. */
export async function makePrivateSpace(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
): Promise<void> {
  await workspaceRequest(fetcher, base, token, workspaceId, "/private", { method: "PUT" });
}

/** Gives a member a level in a unit, or a new one. */
export async function setGrant(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  unit: string,
  user: string,
  level: string,
): Promise<void> {
  await workspaceRequest(fetcher, base, token, workspaceId, `/units/${unit}/grants/${user}`, {
    method: "PUT",
    body: { level },
  });
}

export async function removeGrant(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  unit: string,
  user: string,
): Promise<void> {
  await workspaceRequest(fetcher, base, token, workspaceId, `/units/${unit}/grants/${user}`, {
    method: "DELETE",
  });
}

/** Shares a page on its own, with its subpages; gives its unit. */
export async function sharePage(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  note: string,
): Promise<string> {
  const answer = record(
    await workspaceRequest(fetcher, base, token, workspaceId, "/pages", { body: { note } }),
  );
  return text(answer.id, base);
}

export async function restrictPage(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  unit: string,
  restricted: boolean,
): Promise<void> {
  await workspaceRequest(fetcher, base, token, workspaceId, `/pages/${unit}`, {
    method: "PATCH",
    body: { restricted },
  });
}

export async function stopSharingPage(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  unit: string,
): Promise<void> {
  await workspaceRequest(fetcher, base, token, workspaceId, `/pages/${unit}`, {
    method: "DELETE",
  });
}

/** Invites a guest to a shared page at a level; gives the token its link carries. */
export async function inviteGuest(
  fetcher: Fetch,
  base: string,
  token: string,
  workspaceId: string,
  unit: string,
  level: string,
  email: string,
): Promise<string> {
  const answer = record(
    await workspaceRequest(fetcher, base, token, workspaceId, "/invitations", {
      body: {
        role: "guest",
        unit,
        level,
        ...(email.trim() === "" ? {} : { email: email.trim() }),
      },
    }),
  );
  return text(answer.token, base);
}

/** A level's name as people read it; one this app does not know, as the server gave it. */
export function levelName(level: string): string {
  switch (level) {
    case "full":
      return t("level_full");
    case "edit":
      return t("level_edit");
    case "comment":
      return t("level_comment");
    case "view":
      return t("level_view");
    default:
      return level;
  }
}
