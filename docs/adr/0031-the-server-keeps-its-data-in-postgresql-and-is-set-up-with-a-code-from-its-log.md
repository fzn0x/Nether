# 0031. The server keeps its data in PostgreSQL, and is set up with a code from its log

- Status: Accepted
- Date: 2026-10-31

## Context

Phase 3 turns the server of [ADR 0005](0005-server-on-fastify.md), which
so far only answers a health check, into the one sync, sharing and
collaboration run on. Everything it will hold needs a home first:
accounts, workspaces and who belongs to them, then Yjs updates, history,
permissions and comments. The
[architecture](../architecture.md) names PostgreSQL 16 or newer for
metadata, Yjs history and search, and the
[requirements](../requirements.md#apps-and-deployment) ask for:

- `docker compose up` that starts a working server, whose first run
  creates the admin account;
- migrations that run on their own and are safe to skip versions within a
  major release;
- a server that meets OWASP ASVS Level 2, with argon2id password hashing;
- several server nodes, for high availability, on one database.

Three questions follow: how the server talks to PostgreSQL and how its
schema changes, how its tests get a database, and who may make the first
account on a server nobody has signed in to.

## Decision

**PostgreSQL through node-postgres, behind a small interface.** The server
reaches its database through `Database` in `apps/server/src/db.ts`: `query`
with `$1`-style parameters, `transaction`, and `close`. `connectPostgres`
implements it on a `pg` pool. Rows come back as `Record<string, unknown>`,
and the code that reads a column checks its type, since SQL's types are not
TypeScript's. `NETHER_DATABASE_URL` is required, and must be a
`postgres://` or `postgresql://` address.

**Migrations are numbered plain SQL, run at start.** `src/migrations.ts`
lists them in order. Each start runs `migrate`, which in one transaction:

1. takes a PostgreSQL advisory lock of Nether's own, so nodes starting at
   once wait for each other;
2. reads the highest version in `schema_migrations`;
3. refuses to go on if that is newer than the server knows, since it
   would not know the schema;
4. applies each missing migration and records it.

A failed migration rolls back with the rest, leaving the database as it
was. Migrations are never edited once released, only added, so a server
can skip versions and still apply every one between.

**Tests run on PGlite, and CI also on PostgreSQL.** The server's tests take
their database from `testDatabase()`: [PGlite](https://pglite.dev),
PostgreSQL compiled to WebAssembly in the test's own process
(Apache-2.0, a development dependency only), so they need no server or
Docker. With `NETHER_TEST_DATABASE_URL` set, as CI sets it to a
PostgreSQL 16 service, each test gets a schema of its own on that server
instead, dropped when it closes. CI's smoke run starts the built server on
that PostgreSQL and checks it waits to be set up.

**The first account is made with a setup code from the server's log.**
While the database has no user, every start writes a new code to the log:
20 characters from an alphabet without look-alikes (no 0, O, 1 or I), in
groups of five, about 100 bits. `POST /api/setup` with that code, a name,
an email address, a password of 12 or more characters and a workspace
name makes, in one transaction under a lock, the instance's admin, the
workspace and the admin's membership as its owner. A second attempt gets
409, a wrong code 403. The code is compared in constant time, without its
dashes and in any case, as people type it. `GET /api/setup` says whether
setup is still needed, for the app to know which screen to show.

**Passwords are argon2id hashes, from hash-wasm.** With OWASP's
parameters: 19 MiB of memory, two passes, one lane, a 16-byte random
salt, stored as the encoded string that carries them, so they can be
raised later and old hashes still checked.

The first migration makes `users`, `workspaces` and `memberships`, with
the four workspace roles of the requirements. An email address is unique
as compared in lowercase. A workspace records whether it is end-to-end
encrypted, since that is decided when it is made.

## Alternatives

- **An ORM or query builder (Prisma, Drizzle, Kysely).** Each adds a layer
  between the server and SQL that the server barely needs: most of what it
  will store is Yjs updates as bytes and a few tables of metadata, and
  each brings its own schema language or migration format. Plain SQL keeps
  migrations readable by any admin who restores a backup.
- **A migration tool (node-pg-migrate, graphile-migrate).** The runner here
  is about 30 lines; a tool would add files on disk to ship in the Docker image
  and a second way to run them.
- **postgres.js instead of node-postgres.** Both are fine and
  MIT-licensed; node-postgres is the most used, and the longest
  maintained.
- **Tests against a PostgreSQL in Docker only.** Every contributor would
  need Docker running to run `pnpm test`. PGlite runs the same SQL in
  process, and CI still checks a real server.
- **The first visitor makes the admin account, as many self-hosted apps
  do.** A server reachable from the internet before its owner opens it
  could be claimed by anyone who finds it first. The code proves the
  person can read the server's log.
- **An admin account from environment variables.** It puts a password in
  the Compose file and the process environment. It may still come as an
  option for automated installs.
- **bcrypt, or argon2 through a native module.** The requirements name
  argon2id. Native modules need a compiler or prebuilt binaries for each
  platform; hash-wasm (MIT) is WebAssembly and runs wherever Node does.

## Consequences

- The server now needs PostgreSQL to start; `docker compose up` will start
  one with it, later in this phase.
- Every feature that stores data adds a migration, never edits one, and
  tests it on PGlite. Where PGlite and PostgreSQL differ, CI's run on
  PostgreSQL catches it.
- A query's rows must be checked as they are read, which is more code than
  a typed result, and safer.
- The setup code is in the log, so whoever can read the log can set up a
  new server; after setup the code is gone and no new one is made.
- Revisit the setup code if installs need to be set up without reading a
  log, with an admin account from environment variables beside it.
