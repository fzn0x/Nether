# 0032. Sessions are bearer tokens kept as hashes, and accounts come by invitation

- Status: Accepted
- Date: 2026-10-31

## Context

[ADR 0031](0031-the-server-keeps-its-data-in-postgresql-and-is-set-up-with-a-code-from-its-log.md)
gave the server its first account. The roadmap's next item is accounts:
email and password with argon2id, magic links and OIDC, with rate limits.
It comes in three pull requests, and this record covers the first:

- how a client stays signed in;
- how anyone but the admin gets an account;
- how password guessing is held back.

Magic links need the admin's SMTP, and OIDC an identity provider; each gets
its own pull request.

The [requirements](../requirements.md#non-functional-requirements) ask for
OWASP ASVS Level 2. Its fifth version leaves a session's idle and absolute
timeouts to a documented decision (V7.3). It asks that users can see their
sessions and end any of them after authenticating again (V7.5.2), and that
guessing is limited (V6.3.1).

The clients so far:

- The desktop app, which syncs in the background for weeks and works
  offline.
- The web app, which comes later in this phase.

## Decision

**A session is a bearer token, kept as its hash.**

- Signing in (`POST /api/sessions`) gives a token of 32 random bytes
  (base64url), which the client sends as `Authorization: Bearer <token>`.
- The `sessions` table keeps its SHA-256, with the client's User-Agent, so
  a copy of the database signs no one in.
- Tokens are not sent in cookies yet. The web app will add a cookie for the
  same session, with its CSRF defence, when it arrives. Bearer tokens are
  not sent by browsers on their own, so they need none.

**A session ends after 30 days unused, or 90 days after it began.** A
desktop app syncing daily stays signed in for three months, and one left
unused for a month signs in again; signing in is needed only to sync, not
to write. Use is recorded at most every five minutes.

**Account holders can manage their own sessions.**

- `GET /api/sessions` lists them, marking the current one.
- `DELETE /api/sessions/current` signs out.
- `POST /api/sessions/revoke` ends one other session, or all of them, with
  the account's password. An account without a password, as OIDC will
  make, instead needs a sign-in within the last ten minutes.
- `PUT /api/me/password` needs the current password, and ends every other
  session.

**Accounts come by invitation.**

- A workspace's owner or admin invites someone as an admin or a member
  (`POST /api/workspaces/:id/invitations`), and gets a token to send as a
  link. Invitations may name an email address, and only that address may
  accept them.
- The token is kept as its SHA-256, lasts seven days, and is accepted once
  (`POST /api/invitations/accept`): signed in, into that account, or with a
  name, address and password, as a new account that is signed in at once.
- Someone already in the workspace keeps their role.
- Tokens travel in request bodies, never in addresses, which logs keep.
- Guests come with page permissions, since they are invited to pages, not
  workspaces.
- There is no open sign-up: a server reachable from the internet makes
  accounts only for people its members invite.

**Guessing is held back by address and by account.** With
`@fastify/rate-limit` (MIT):

| What | Limit |
| --- | --- |
| Signing in, per address | 30 tries in 5 minutes |
| Signing in, per account named | 10 tries in 15 minutes, so many addresses cannot guess one password together |
| Setup | 20 tries in 15 minutes |
| Accepting invitations | 20 tries in 15 minutes |
| Looking up invitations | 30 tries in 5 minutes |
| Ending sessions and changing passwords | 10 tries in 15 minutes |

- Each answers 429 with `Retry-After`.
- The plugin applies one limit per request, so the per-account limit is a
  hook of Nether's own on the plugin's `createRateLimit`.
- An address without an account is checked against a decoy hash, so a
  wrong password and an unknown address take as long and answer alike.
- The per-account limit is a soft lockout: it holds back new sign-ins for
  that account for at most 15 minutes, and never ends a session. Someone
  who knows an address can keep it from signing in anew by guessing ten
  times every 15 minutes, while every device already signed in goes on
  working. That is the price of stopping a password from being guessed
  from many addresses at once.

**Behind a proxy, `NETHER_TRUST_PROXY` says whose `X-Forwarded-For` to
believe:** `off` (the default), `on`, or the proxies' addresses and ranges.
Without it every client behind a proxy shares the proxy's address and its
limits. Fastify no longer trusts a count of hops, which a client can forge,
so Nether does not offer one.

**Every error has Fastify's shape**, `{ statusCode, error, message }`, for
clients to show `message`.

## Alternatives

- **Signed tokens (JWTs) instead of sessions in the database.** They cannot
  be ended before they expire without a list of ended ones, which is a
  session table again, and V7.5.2 requires ending them. One lookup per
  request by a unique index is cheap.
- **Cookies now.** The only client today is the desktop app, which is not a
  browser; cookies would bring CSRF to defend before a browser uses them.
- **Shorter timeouts, as ASVS 4's Level 2 table had (12 hours, or 30
  minutes idle).** A sync client would sign in again every day, and people
  would choose weaker passwords to type them often. ASVS 5 leaves this to
  a decision like this one, and an admin setting can shorten it later.
- **Open sign-up, or accounts the admin makes with a password.** Open
  sign-up on a self-hosted server invites strangers. An admin choosing
  others' passwords means passwords travel by chat.
- **Rate limits in PostgreSQL, for several nodes.** The limits live in each
  node's memory until Redis or Valkey arrives with `docker compose`, which
  the plugin can use as its store.

## Consequences

- Every client keeps a token, and sends it on every request to the API and,
  later, the sync server.
- The web app's pull request adds a cookie for its sessions and a CSRF
  defence.
- With several nodes, each counts tries on its own until the limits move
  to Redis; the HA work does that.
- Magic links and OIDC sign in through `startSession`, and accept
  invitations the same way. They also give a person held back by the
  per-account limit another way in.
- Revisit the timeouts when the admin console can set them per workspace,
  and the per-account limit if people are kept out by it: a limit by
  account and address together, for addresses the account has signed in
  from, would keep them in.
