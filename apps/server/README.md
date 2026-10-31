# @nether/server

The Nether server: the API and the Yjs sync server (Hocuspocus) in one Node
service on [Fastify](https://fastify.dev), backed by PostgreSQL, Redis or
Valkey, and local or S3-compatible file storage. Clients talk to it only to
sync and share. See [ADR 0005](../../docs/adr/0005-server-on-fastify.md).

So far it answers `GET /health`, brings its PostgreSQL database to its
schema as it starts, makes the first account through first-run setup, signs
people in, invites others into workspaces, syncs their notes' Yjs
documents, and holds the extension point through which the free
[enterprise features](../../enterprise/) plug in.
Sync, sharing and the rest arrive in Phase 3. See ADRs
[0031](../../docs/adr/0031-the-server-keeps-its-data-in-postgresql-and-is-set-up-with-a-code-from-its-log.md),
[0032](../../docs/adr/0032-sessions-are-bearer-tokens-and-accounts-come-by-invitation.md),
[0033](../../docs/adr/0033-sign-in-by-email-with-a-code-and-the-link-with-the-web-app.md)
[0034](../../docs/adr/0034-sign-in-with-openid-connect-through-the-server-and-back-to-the-app.md)
[0035](../../docs/adr/0035-the-server-syncs-through-hocuspocus-beside-its-api-and-numbers-each-store.md)
and [0038](../../docs/adr/0038-encrypted-workspaces-seal-a-key-to-each-member-and-relay-updates-the-server-cannot-read.md).

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
| `GET /api/sign-in-methods` | | Which ways to sign in this server offers: `password`, `emailCode` when it can send email, and `oidc` with the provider's name |
| `POST /api/sessions` | | Signs in with `email` and `password`; gives `token` and `expiresAt` |
| `POST /api/sign-in-codes` | | Emails a code to sign in to `email`, if it has an account; answers 202 either way |
| `POST /api/sign-in-codes/redeem` | | Signs in with `email` and its `code`, as signing in with a password does |
| `POST /api/oidc/flows` | | Starts signing in with the OIDC provider: the app's `redirect` and PKCE `challenge`, and an `invitation` if any; gives the provider's `url` to open |
| `GET /api/oidc/callback` | | Where the provider sends the browser; sends it on to the app's `redirect` with a `code` or an `error` |
| `POST /api/oidc/redeem` | | Signs in with that `code` and the app's PKCE `verifier` |
| `GET /api/sessions` | yes | The account's sessions, the current one marked |
| `DELETE /api/sessions/current` | yes | Signs out |
| `POST /api/sessions/revoke` | yes | Ends the session `session`, or every other one, with `password` |
| `GET /api/me` | yes | The account, and the workspaces it is in with its role in each |
| `PUT /api/me/password` | yes | Changes the password from `current`; ends every other session |
| `POST /api/workspaces/:id/invitations` | owner, admin | Invites someone as `admin` or `member`, for one `email` or anyone; gives `token` |
| `GET /api/workspaces/:id/invitations` | owner, admin | The invitations not yet accepted |
| `DELETE /api/workspaces/:id/invitations/:invitation` | owner, admin | Withdraws one |
| `POST /api/workspaces` | yes | Makes a workspace the account owns, with `name`; `encryption: "end-to-end"` and the maker's `sealedKey` make it encrypted |
| `PUT /api/me/keys`, `GET /api/me/keys` | yes | The account's `publicKey`, and its private key in a `recoveryBox` only its recovery phrase opens; kept once |
| `GET /api/workspaces/:id/key` | member | The account's own sealed copy of an encrypted workspace's key, at its latest `version` |
| `GET /api/workspaces/:id/keyless` | member | The members with keys and no copy of the latest version, for one who has it to seal |
| `PUT /api/workspaces/:id/keys/:user` | keyholder | Seals the key for a member waiting; a copy kept is never replaced |
| `PUT /api/workspaces/:id/attachments/:hash` | member | Keeps a file's bytes, sent as `application/octet-stream`, if they hash to `hash` (SHA-256); `x-content-type` names its media type |
| `HEAD /api/workspaces/:id/attachments/:hash` | member | Whether the workspace has the file, before sending it |
| `GET /api/workspaces/:id/attachments/:hash` | member | The file, served so it runs and loads nothing |
| `GET /api/workspaces/:id/documents/:note/versions` | member | The note's versions, the latest 200 first: `{ versions: [{ id, time }] }` |
| `GET /api/workspaces/:id/documents/:note/versions/:version` | member | A version, as the Yjs state the note had |
| `GET /api/relay` | per message | The WebSocket encrypted workspaces sync over, below |
| `GET /api/workspaces/:id/documents` | member | The documents stored since `since`, a number, in order, a thousand at a time with `more` |
| `GET /api/sync` | per document | The WebSocket that Hocuspocus providers sync documents over, below |
| `POST /api/invitations/lookup` | | The workspace and role a `token` invites to |
| `POST /api/invitations/accept` | either | Accepts a `token`: signed in, into that account; or with `name`, `email` and `password`, as a new account, signed in |

A session ends when its client signs out, after 30 days unused, or 90
days after it began. Invitations last seven days and are accepted once.
A code emailed to sign in works once, within 15 minutes, and five wrong
tries spend it. Only the SHA-256 of a session's or an invitation's token,
or of a code, is kept.

Signing in is limited to 30 tries in five minutes from one address, and 10
in 15 minutes for one account from anywhere. One email address gets at
most three codes in 15 minutes. Setup, invitations, ending sessions and
changing passwords have limits of their own. Each answers `429` with
`Retry-After`.

## Sync

Clients sync Yjs documents with Hocuspocus over one WebSocket at
`/api/sync`, on the API's own port, so a reverse proxy needs only to pass
WebSocket upgrades through. A document is named `<workspace id>/vault`, the
vault's list of notes, or `<workspace id>/<note id>`. A provider signs each
one in with its session's token as Hocuspocus's `token`: a workspace's
members read and write its documents, and its guests only read them.

```ts
new HocuspocusProvider({
  url: "wss://nether.example.org/api/sync",
  name: `${workspaceId}/${noteId}`,
  token: session.token,
});
```

The server stores a document two seconds after it stops changing, and at
least every ten seconds, as its merged state numbered from one sequence. A
client back from being away asks
`GET /api/workspaces/:id/documents?since=<the last number it saw>` and
syncs only those. A client syncing the vault document hears of every note
as it is stored, as the stateless message
`{ "type": "stored", "document": "<note id>", "seq": 42 }`.

## Encrypted workspaces

A workspace made with `encryption: "end-to-end"` is encrypted by its
members' apps, and the server never sees its keys or its notes (ADR 0038).
Each account has a key pair whose private key the server keeps only in a
box its recovery phrase opens; each member has the workspace's key, sealed
to their public key by a member who had it.

Hocuspocus refuses these workspaces' documents. They sync through
`/api/relay`, which keeps each encrypted update in order, numbered from the
same sequence, and sends it on. A socket sends `{"type":"auth","token"}`,
then:

| Message | Answer |
| --- | --- |
| `{"type":"subscribe","name","after"}` | `updates` of `{seq, data}` stored since `after`, then `subscribed` with the last number, then each update pushed |
| `{"type":"push","id","name","data"}` | `pushed` with the update's `seq`; the vault document's subscribers hear `stored` |
| `{"type":"compact","id","name","through","data"}` | `compacted`: the snapshot replaces the updates up to `through` |
| `{"type":"unsubscribe","name"}` | none |

Data is base64. Guests may subscribe, not push or compact.

## Attachments

Files notes embed are kept by the SHA-256 of their bytes, once per
workspace ([ADR 0039](../../docs/adr/0039-attachments-are-kept-by-their-hash-on-disk-or-in-an-s3-bucket.md)). By default they are files
under `NETHER_STORAGE_PATH`; with `NETHER_STORAGE=s3` they are objects in an
S3-compatible bucket, such as MinIO, Garage, Cloudflare R2 or Amazon S3:

```sh
NETHER_STORAGE=s3
NETHER_S3_ENDPOINT=http://minio:9000
NETHER_S3_BUCKET=nether
NETHER_S3_ACCESS_KEY=…
NETHER_S3_SECRET_KEY=…
```

Objects are addressed by path, as `<endpoint>/<bucket>/<workspace>/<hash>`.

## History

When sync stores a note whose last version is ten minutes old, the server
keeps the state the store replaces as a version, so a note's history has
it as it was before each spell of editing
([ADR 0041](../../docs/adr/0041-a-notes-history-is-its-earlier-texts-kept-before-each-spell-of-editing.md)). It keeps versions for
`NETHER_HISTORY_DAYS`, 30 days unless set, and deletes older ones when it
starts and every hour. An encrypted workspace has no versions here: its
devices keep their own.

## Email

Set `NETHER_SMTP_URL` and `NETHER_MAIL_FROM` for the server to send email:
so far, the codes that sign in by email. Without them it sends none, and
the app offers only passwords.

```sh
NETHER_SMTP_URL=smtp://nether:secret@mail.example.org:587
NETHER_MAIL_FROM='Nether <nether@example.org>'
```

`smtp://` uses STARTTLS when the mail server offers it; `smtps://` (port
465) uses TLS from the start. A message that cannot be sent is written to
the server's log.

## Signing in with OpenID Connect

People can sign in with the team's OpenID Connect provider, such as
Keycloak, Authentik, Okta, Microsoft Entra ID or Google. Register Nether
with it as a confidential client whose redirect address is
`NETHER_PUBLIC_URL/api/oidc/callback`, then set:

```sh
NETHER_PUBLIC_URL=https://nether.example.org
NETHER_OIDC_ISSUER=https://login.example.org/realms/team
NETHER_OIDC_CLIENT_ID=nether
NETHER_OIDC_CLIENT_SECRET=…
NETHER_OIDC_NAME=Keycloak
```

The provider's identity signs in to the account whose address the provider
has verified, and stays linked to it. A person without an account signs in
only with an invitation, unless `NETHER_OIDC_SIGN_UP=on` lets everyone the
provider signs in have one. A provider named with `http://` is used, with a
warning in the log: do that only on a private network.

The app opens the provider in the browser and listens on a loopback
address, by IP, for the browser to come back with a code, which it redeems
with its PKCE verifier (RFC 8252). The web app comes back to the server's
own address.

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
| `NETHER_SMTP_URL` | none | The SMTP server email goes through, as `smtp://user:password@host:587` or `smtps://user:password@host:465` |
| `NETHER_MAIL_FROM` | none, required with `NETHER_SMTP_URL` | The sender, as `Nether <nether@example.org>` |
| `NETHER_PUBLIC_URL` | none | The address people reach the server at, as `https://nether.example.org`; needed for OIDC |
| `NETHER_OIDC_ISSUER` | none | The OpenID Connect provider's issuer; sets up signing in with it |
| `NETHER_OIDC_CLIENT_ID` | none, required with the issuer | Nether's client ID at the provider |
| `NETHER_OIDC_CLIENT_SECRET` | none | Its secret; without one, a public client using PKCE alone |
| `NETHER_OIDC_NAME` | `single sign-on` | The provider's name on the app's button |
| `NETHER_OIDC_SIGN_UP` | `off` | Whether anyone the provider signs in gets an account, not only the invited |
| `NETHER_STORAGE` | `disk` | Where attachments are kept: `disk` or `s3` |
| `NETHER_STORAGE_PATH` | `data/attachments` | The folder for `disk`, relative to where the server runs |
| `NETHER_S3_ENDPOINT` | none, required for `s3` | The S3-compatible store's address |
| `NETHER_S3_BUCKET`, `NETHER_S3_ACCESS_KEY`, `NETHER_S3_SECRET_KEY` | none, required for `s3` | The bucket and the keys to it |
| `NETHER_S3_REGION` | `us-east-1` | The region requests are signed for |
| `NETHER_ATTACHMENT_LIMIT` | `100` | The largest attachment taken, in MiB |
| `NETHER_HISTORY_DAYS` | `30` | How many days notes' earlier versions are kept |
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
