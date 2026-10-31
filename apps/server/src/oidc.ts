// Signing in with an OpenID Connect provider (ADR 0034), as an app that is
// not a browser does it (RFC 8252):
//
// 1. The app starts a flow, naming where the browser should come back to
//    (a loopback address of its own, or the server's address for the web
//    app) and a PKCE challenge of its own, and opens the address it gets.
// 2. The browser signs in at the provider, which sends it to the server's
//    callback. The server takes the provider's answer, with PKCE, a state
//    and a nonce of its own, and finds the account: by the identity, by a
//    verified email address, or, if it may, makes one.
// 3. The server sends the browser back to the app with a code that lasts a
//    minute, which the app redeems with its PKCE verifier for a session.
//
// No token reaches the browser's address bar or history, and a code taken
// from the redirect is no use without the verifier the app kept.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import * as client from "openid-client";
import type { OidcConfig } from "./config.ts";
import { type Database, type Queryable, readBoolean, readText, readTextOrNull } from "./db.ts";
import { emailKey, fail, tokenField } from "./http.ts";
import { acceptInvitation, invites, openInvitation } from "./invitations.ts";
import { newToken, startSession, tokenHash } from "./sessions.ts";

/** Minutes a flow may take at the provider. */
const flowMinutes = 10;
/** Seconds the app has to redeem the code the browser brings back. */
const handoffSeconds = 60;

/** Why a sign-in failed, as the app reads it from the address it comes back to. */
export type OidcError =
  | "access_denied"
  | "no_account"
  | "email_not_verified"
  | "invitation"
  | "other_address"
  | "provider_error";

/**
 * Whether the browser may be sent back to an address: the app's loopback
 * address, by IP as RFC 8252 asks, on any port, or the server's own.
 */
export function mayReturnTo(redirect: string, publicUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
  if (url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)) return true;
  return url.origin === new URL(publicUrl).origin;
}

/** A PKCE challenge for a verifier, as S256 makes it. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

interface Start {
  readonly redirect: string;
  readonly challenge: string;
  readonly invitation?: string;
}

const startBody = {
  type: "object",
  required: ["redirect", "challenge"],
  additionalProperties: false,
  properties: {
    redirect: { type: "string", minLength: 1, maxLength: 2000 },
    // S256 of a verifier: 32 bytes in base64url.
    challenge: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
    invitation: tokenField,
  },
} as const;

interface Callback {
  readonly state?: string;
  readonly code?: string;
  readonly error?: string;
}

interface Redeem {
  readonly code: string;
  readonly verifier: string;
}

const redeemBody = {
  type: "object",
  required: ["code", "verifier"],
  additionalProperties: false,
  // A PKCE verifier is 43 to 128 characters (RFC 7636).
  properties: { code: tokenField, verifier: { type: "string", minLength: 43, maxLength: 128 } },
} as const;

/** What the provider says of the person it signed in. */
interface Person {
  readonly subject: string;
  /** The address, only if the provider has verified it. */
  readonly email: string | undefined;
  readonly name: string;
}

function personOf(claims: client.IDToken): Person {
  const email = typeof claims.email === "string" ? claims.email.trim() : "";
  const verified = claims.email_verified === true && email !== "";
  const name = [claims.name, claims.preferred_username]
    .find((value): value is string => typeof value === "string" && value.trim() !== "")
    ?.trim();
  const local = email.split("@")[0] ?? "";
  return {
    subject: claims.sub,
    email: verified ? email : undefined,
    name: name ?? (local === "" ? "Nether user" : local),
  };
}

type Outcome =
  { readonly userId: string; readonly workspaceId: string | null } | { readonly error: OidcError };

export function registerOidc(
  app: FastifyInstance,
  db: Database,
  oidc: OidcConfig,
  publicUrl: string,
): void {
  const callbackUrl = `${publicUrl}/api/oidc/callback`;
  const plainHttp = oidc.issuer.startsWith("http:");
  if (plainHttp) {
    app.log.warn(
      { issuer: oidc.issuer },
      "The OpenID Connect provider answers over plain HTTP: use it only on a private network",
    );
  }

  // The provider's metadata, found once and found again after a failure.
  let discovered: Promise<client.Configuration> | undefined;
  function provider(): Promise<client.Configuration> {
    discovered ??= client
      .discovery(
        new URL(oidc.issuer),
        oidc.clientId,
        oidc.clientSecret ?? undefined,
        oidc.clientSecret === null ? client.None() : undefined,
        // An admin may name a provider on the same private network, such as
        // Keycloak beside the server, that answers over plain HTTP. The
        // library marks the switch deprecated only so it stands out.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        plainHttp ? { execute: [client.allowInsecureRequests] } : undefined,
      )
      .catch((error: unknown) => {
        discovered = undefined;
        throw error;
      });
    return discovered;
  }

  /** The account a person signs in to, made if they may have one, and the invitation they accept. */
  async function resolve(
    tx: Queryable,
    person: Person,
    invitationHash: string | null,
  ): Promise<Outcome> {
    const invitation =
      invitationHash === null ? undefined : await openInvitation(tx, invitationHash);
    if (invitationHash !== null && invitation === undefined) return { error: "invitation" };

    const known = await tx.query(
      "SELECT user_id FROM identities WHERE issuer = $1 AND subject = $2",
      [oidc.issuer, person.subject],
    );
    let userId = known.rows.length > 0 ? readText(known.rows[0], "user_id") : undefined;
    let email: string | undefined;
    if (userId === undefined) {
      if (person.email === undefined) return { error: "email_not_verified" };
      email = person.email;
      const byEmail = await tx.query("SELECT id FROM users WHERE email_key = $1", [
        emailKey(email),
      ]);
      userId = byEmail.rows.length > 0 ? readText(byEmail.rows[0], "id") : undefined;
      if (userId === undefined) {
        if (!oidc.signUp && invitation === undefined) return { error: "no_account" };
        if (invitation !== undefined && !invites(invitation, email)) {
          return { error: "other_address" };
        }
        userId = randomUUID();
        await tx.query("INSERT INTO users (id, email, email_key, name) VALUES ($1, $2, $3, $4)", [
          userId,
          email,
          emailKey(email),
          person.name,
        ]);
      }
      await tx.query("INSERT INTO identities (issuer, subject, user_id) VALUES ($1, $2, $3)", [
        oidc.issuer,
        person.subject,
        userId,
      ]);
    }

    if (invitation === undefined) return { userId, workspaceId: null };
    if (email === undefined) {
      const { rows } = await tx.query("SELECT email FROM users WHERE id = $1", [userId]);
      email = readText(rows[0], "email");
    }
    if (!invites(invitation, email)) return { error: "other_address" };
    const workspace = await acceptInvitation(tx, invitation, userId);
    return { userId, workspaceId: workspace.id };
  }

  /** Sends the browser back to the app, with a code or an error. */
  function back(reply: FastifyReply, redirect: string, query: Record<string, string>) {
    const url = new URL(redirect);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return reply.redirect(url.href, 302);
  }

  app.post<{ Body: Start }>(
    "/api/oidc/flows",
    {
      schema: { body: startBody },
      onRequest: app.rateLimit({ max: 30, timeWindow: "5 minutes" }),
    },
    async (request, reply) => {
      const { body } = request;
      if (!mayReturnTo(body.redirect, publicUrl)) {
        return fail(
          reply,
          400,
          "The address to come back to must be the app's loopback address, by IP, or this server's.",
        );
      }
      let config: client.Configuration;
      try {
        config = await provider();
      } catch (error) {
        request.log.error({ err: error }, "Could not reach the OpenID Connect provider");
        return fail(reply, 503, `${oidc.name} cannot be reached; try again later.`);
      }
      const state = client.randomState();
      const nonce = client.randomNonce();
      const verifier = client.randomPKCECodeVerifier();
      await db.query("DELETE FROM oidc_flows WHERE expires_at < now()");
      await db.query(
        `INSERT INTO oidc_flows
           (id, state_hash, nonce, verifier, redirect, challenge, invitation_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8 * interval '1 minute')`,
        [
          randomUUID(),
          tokenHash(state),
          nonce,
          verifier,
          body.redirect,
          body.challenge,
          body.invitation === undefined ? null : tokenHash(body.invitation),
          flowMinutes,
        ],
      );
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: callbackUrl,
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      });
      return reply.code(201).send({ url: url.href });
    },
  );

  app.get<{ Querystring: Callback }>(
    "/api/oidc/callback",
    { onRequest: app.rateLimit({ max: 30, timeWindow: "5 minutes" }) },
    async (request, reply) => {
      const state = typeof request.query.state === "string" ? request.query.state : "";
      const { rows } = await db.query(
        `SELECT id, nonce, verifier, redirect, invitation_hash FROM oidc_flows
          WHERE state_hash = $1 AND handoff_hash IS NULL AND expires_at > now()`,
        [tokenHash(state)],
      );
      const flow = rows[0];
      if (flow === undefined) {
        return reply
          .code(400)
          .type("text/plain; charset=utf-8")
          .send("This sign-in has expired or was used already. Start again from the app.");
      }
      const flowId = readText(flow, "id");
      const redirect = readText(flow, "redirect");
      const failed = async (error: OidcError) => {
        await db.query("DELETE FROM oidc_flows WHERE id = $1", [flowId]);
        return back(reply, redirect, { error });
      };
      if (request.query.error !== undefined) return failed("access_denied");

      let person: Person;
      try {
        // The address the provider sent the browser to, as it was registered.
        const current = new URL(callbackUrl);
        current.search = new URL(request.url, "http://callback").search;
        const tokens = await client.authorizationCodeGrant(await provider(), current, {
          pkceCodeVerifier: readText(flow, "verifier"),
          expectedState: state,
          expectedNonce: readText(flow, "nonce"),
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (claims === undefined) throw new Error("The provider gave no ID token");
        person = personOf(claims);
      } catch (error) {
        request.log.error({ err: error }, "The OpenID Connect provider's answer was refused");
        return failed("provider_error");
      }

      const outcome = await db.transaction(async (tx) => {
        // Taken now, so a second answer with the same state finds it gone.
        const taken = await tx.query(
          `SELECT id FROM oidc_flows WHERE id = $1 AND handoff_hash IS NULL FOR UPDATE`,
          [flowId],
        );
        if (taken.rows.length === 0) return { error: "provider_error" } as const;
        const resolved = await resolve(tx, person, readTextOrNull(flow, "invitation_hash"));
        if ("error" in resolved) return resolved;
        const code = newToken();
        await tx.query(
          `UPDATE oidc_flows
              SET handoff_hash = $2, user_id = $3, workspace_id = $4,
                  expires_at = now() + $5 * interval '1 second'
            WHERE id = $1`,
          [flowId, tokenHash(code), resolved.userId, resolved.workspaceId, handoffSeconds],
        );
        return { code };
      });
      if ("error" in outcome) return failed(outcome.error);
      return back(reply, redirect, { code: outcome.code });
    },
  );

  app.post<{ Body: Redeem }>(
    "/api/oidc/redeem",
    {
      schema: { body: redeemBody },
      onRequest: app.rateLimit({ max: 30, timeWindow: "5 minutes" }),
    },
    async (request, reply) => {
      const outcome = await db.transaction(async (tx) => {
        // Spent by any try, right or wrong.
        const { rows } = await tx.query(
          `DELETE FROM oidc_flows
            WHERE handoff_hash = $1 AND expires_at > now()
            RETURNING challenge, user_id, workspace_id`,
          [tokenHash(request.body.code)],
        );
        const flow = rows[0];
        if (flow === undefined) return undefined;
        const challenge = Buffer.from(readText(flow, "challenge"));
        const proven = Buffer.from(pkceChallenge(request.body.verifier));
        if (challenge.length !== proven.length || !timingSafeEqual(challenge, proven)) {
          return undefined;
        }
        const userId = readText(flow, "user_id");
        const users = await tx.query(
          "SELECT name, email, instance_admin FROM users WHERE id = $1",
          [userId],
        );
        const user = users.rows[0];
        const workspaceId = readTextOrNull(flow, "workspace_id");
        const workspaces =
          workspaceId === null
            ? undefined
            : await tx.query(
                `SELECT w.name, m.role FROM workspaces w
                   JOIN memberships m ON m.workspace_id = w.id AND m.user_id = $2
                  WHERE w.id = $1`,
                [workspaceId, userId],
              );
        const workspace = workspaces?.rows[0];
        return {
          ...(await startSession(tx, userId, request)),
          user: {
            id: userId,
            name: readText(user, "name"),
            email: readText(user, "email"),
            instanceAdmin: readBoolean(user, "instance_admin"),
          },
          ...(workspaceId === null || workspace === undefined
            ? {}
            : {
                workspace: {
                  id: workspaceId,
                  name: readText(workspace, "name"),
                  role: readText(workspace, "role"),
                },
              }),
        };
      });
      if (outcome === undefined) {
        return fail(reply, 401, "That sign-in code was used, has expired, or is not this app's.");
      }
      return reply.code(201).send(outcome);
    },
  );
}
