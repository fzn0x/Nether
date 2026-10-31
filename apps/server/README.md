# @nether/server

The Nether server: the API and the Yjs sync server (Hocuspocus) in one Node
service on [Fastify](https://fastify.dev), backed by PostgreSQL, Redis or
Valkey, and local or S3-compatible file storage. Clients talk to it only to
sync and share. See [ADR 0005](../../docs/adr/0005-server-on-fastify.md).

So far it answers `GET /health`, brings its PostgreSQL database to its
schema as it starts, makes the first account through first-run setup, signs
people in, invites others into workspaces, and holds the extension point
through which the free [enterprise features](../../enterprise/) plug in.
Sync, sharing and the rest arrive in Phase 3. See ADRs
[0031](../../docs/adr/0031-the-server-keeps-its-data-in-postgresql-and-is-set-up-with-a-code-from-its-log.md)
and [0032](../../docs/adr/0032-sessions-are-bearer-tokens-and-accounts-come-by-invitation.md).

## Run it

It needs PostgreSQL 16 or newer, and a database for Nether on it.

```sh
pnpm --filter @nether/server build
NETHER_DATABASE_URL=postgres://nether:secret@localhost:5432/nether \
  pnpm --filter @nether/server start    # node dist/main.js
curl http://127.0.0.1:3000/health
```

## First-run setup

A server with no account yet writes a setup code to its log each time it
starts:

```text
The server has no account yet. Set it up from the app with this code: ABCDE-FGHJK-LMNPQ-RSTUV
```

`POST /api/setup` with that code makes the admin account and its first
workspace, once, and signs the admin in; `GET /api/setup` says whether the
server still waits for it. Only someone who can read the server's log can set it up, so a new
server reachable from the internet cannot be claimed by whoever finds it
first.

```sh
curl -X POST http://127.0.0.1:3000/api/setup -H 'content-type: application/json' \
  -d '{"code":"ABCDE-FGHJK-LMNPQ-RSTUV","name":"Ada","email":"ada@example.org",
       "password":"at least twelve characters","workspace":"Team"}'
```

Passwords are kept as argon2id hashes, with OWASP's parameters: 19 MiB of
memory, two passes, one lane.

## API

Requests and answers are JSON. A signed-in request sends its session's
token as `Authorization: Bearer <token>`. Every error is
`{ "statusCode", "error", "message" }`.

| Route | Signed in | |
| --- | --- | --- |
| `GET /health` | | The server's version, and which enterprise features are on |
| `GET /api/setup`, `POST /api/setup` | | First-run setup, above |
| `POST /api/sessions` | | Signs in with `email` and `password`; gives `token` and `expiresAt` |
| `GET /api/sessions` | yes | The account's sessions, the current one marked |
| `DELETE /api/sessions/current` | yes | Signs out |
| `POST /api/sessions/revoke` | yes | Ends the session `session`, or every other one, with `password` |
| `GET /api/me` | yes | The account, and the workspaces it is in with its role in each |
| `PUT /api/me/password` | yes | Changes the password from `current`; ends every other session |
| `POST /api/workspaces/:id/invitations` | owner, admin | Invites someone as `admin` or `member`, for one `email` or anyone; gives `token` |
| `GET /api/workspaces/:id/invitations` | owner, admin | The invitations not yet accepted |
| `DELETE /api/workspaces/:id/invitations/:invitation` | owner, admin | Withdraws one |
| `POST /api/invitations/lookup` | | The workspace and role a `token` invites to |
| `POST /api/invitations/accept` | either | Accepts a `token`: signed in, into that account; or with `name`, `email` and `password`, as a new account, signed in |

A session ends when its client signs out, after 30 days unused, or 90
days after it began. Invitations last seven days and are accepted once.
Only the SHA-256 of a session's or an invitation's token is kept.

Signing in is limited to 30 tries in five minutes from one address, and 10
in 15 minutes for one account from anywhere. Setup, invitations, ending
sessions and changing passwords have limits of their own. Each answers
`429` with `Retry-After`.

## Database

The schema is a list of numbered migrations in
[`src/migrations.ts`](src/migrations.ts). Each start applies the ones the
database lacks, in one transaction under a lock, so several nodes starting
at once apply each once and a failed migration changes nothing. A server
refuses to start on a database a newer server has migrated.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `NETHER_HOST` | `127.0.0.1` | The address to listen on; the Docker image will set `0.0.0.0` |
| `NETHER_PORT` | `3000` | The port; `0` picks a free one |
| `NETHER_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `NETHER_DATABASE_URL` | none, required | The PostgreSQL database, as `postgres://user:password@host:5432/nether` |
| `NETHER_TRUST_PROXY` | `off` | Behind a reverse proxy, whose `X-Forwarded-For` to believe: `on` for any, or addresses and ranges such as `10.0.0.2, 172.16.0.0/12` or `uniquelocal` |
| `NETHER_ENTERPRISE_SSO` | `off` | Single sign-on |
| `NETHER_ENTERPRISE_SCIM` | `off` | Provisioning through SCIM and LDAP |
| `NETHER_ENTERPRISE_AUDIT` | `off` | Audit logs |
| `NETHER_ENTERPRISE_POLICIES` | `off` | Data policies and advanced permissions |
| `NETHER_ENTERPRISE_ADMIN` | `off` | The admin console |
| `NETHER_ENTERPRISE_HA` | `off` | High availability |

A switch takes `on` or `off` (or `true`, `false`, `yes`, `no`, `1`, `0`). A
feature switched on in a build without its module stops the server at
startup with a message that names the variable.

Set `NETHER_TRUST_PROXY` whenever the server is behind a proxy, or every
client shares the proxy's address and its limits on signing in. Use `on`
only when nothing but the proxy can reach the server.

## Tests

```sh
pnpm --filter @nether/server test     # Vitest, through Fastify's inject
pnpm --filter @nether/server smoke    # starts dist/main.js with every enterprise feature off
```

The tests run on [PGlite](https://pglite.dev), PostgreSQL in the test's own
process, so they need no server. With `NETHER_TEST_DATABASE_URL` set, as in
CI, they run on that PostgreSQL instead, each in a schema of its own that it
drops. The smoke run needs `NETHER_DATABASE_URL`.
