# 0035. The server syncs documents through Hocuspocus beside its API, and numbers each store

- Status: Accepted
- Date: 2026-10-31

## Context

[ADR 0003](0003-sync-yjs-hocuspocus.md) chose Yjs documents synced
through Hocuspocus, with a document per note and one per vault listing its
notes, kept in PostgreSQL. The server now has accounts, sessions and
workspace roles
([ADRs 0031 to 0034](0031-the-server-keeps-its-data-in-postgresql-and-is-set-up-with-a-code-from-its-log.md)),
and the next item of the roadmap is sync. This record decides how the
server runs it. A later pull request adds the desktop app's side.

Several forces shape it:

- **Size.** A vault may have 50,000 notes. A client cannot open 50,000
  documents each time it connects, so it must learn which ones changed
  while it was away.
- **Deployment.** Self-hosters put the server behind one reverse proxy,
  with one certificate. A second port for sync means a second route in
  every proxy.
- **Encryption.** End-to-end encrypted vaults, the next item, cannot be
  merged by the server: their updates are kept and relayed in order
  (ADR 0003).

## Decision

**Hocuspocus 4 runs inside the Fastify server, at `/api/sync`.**

- `@fastify/websocket` upgrades the request, and each socket is handed to
  Hocuspocus. Sync shares the API's port, TLS and proxy, and one socket per
  client carries every document it syncs.
- A message may be up to 16 MiB, as a pasted image's data may be.

**Documents are named by workspace.** A document's name is
`<workspace id>/vault` or `<workspace id>/<note id>`, both IDs lowercase
UUIDs. Other names are refused.

**A client signs in each document with its session's token.**

- Hocuspocus asks the server for each document a socket opens.
- The token must sign in an account that is a member of the document's
  workspace. Otherwise the refusal is the same, so it tells nothing about
  the workspace.
- Owners, admins and members read and write. Guests read only: their
  updates are refused, and nothing they type reaches anyone.
- Permissions on pages, inherited down the page tree, come later in this
  phase and narrow this per note.

**A document is kept as its merged state, numbered each time it is
stored.**

- The `documents` table keeps each document's Yjs state, merged, with
  `seq`, a number taken from one PostgreSQL sequence each time it is
  stored.
- Hocuspocus stores a document after two seconds without a change, and at
  least every ten seconds while it changes. Closing the server stores
  every open document before the database closes.
- `GET /api/workspaces/:id/documents?since=N` lists, in order, the
  documents stored since the number a client last saw, a thousand at a
  time. So a client back from a week away syncs the notes that changed,
  not the vault.
- A client syncing the vault document hears, as a stateless message, of
  each note's document as it is stored: `{ "type": "stored", "document",
  "seq" }`. It can then sync notes it does not have open while it stays
  connected.

**What comes later builds on this.**

- **Version history** keeps snapshots of a document as it is stored.
- **End-to-end encrypted vaults** keep and relay their updates in order,
  beside this path, since the server cannot read them.
- **Several server nodes** share documents through Hocuspocus's Redis
  extension, with the high-availability work.

## Alternatives

- **Hocuspocus's own server, on a second port.** It is simplest in code,
  but every proxy needs a second route, and TLS a second listener.
- **Keeping every update, not the merged state.** It records history at
  the grain of a keystroke, and grows without end. Clients sync from the
  merged state either way, and history keeps snapshots at the grain people
  browse.
- **Clients opening every document on connect.** Simple, but 50,000
  handshakes for a vault in which three notes changed.
- **A timestamp instead of a sequence.** Two stores in one millisecond, or
  clocks that differ between nodes, would hide a change; a sequence
  cannot.
- **y-websocket's server.** ADR 0003 chose Hocuspocus for its hooks for
  authentication and storage, which this uses.

## Consequences

- The desktop app's pull request:
  - signs in to a server and links a vault to a workspace;
  - syncs the vault document and the open notes over one socket;
  - catches up on other notes from the list of changes;
  - keeps every update in its SQLite store first, as now, so an offline
    edit waits there and syncs on reconnect.
- A note stored on the server is a merged state of up to 16 MiB per
  message.
- A server with several nodes needs the Redis extension before two
  clients on different nodes see each other's edits.
- Revisit the store's debounce if the server's database writes become a
  bottleneck for 200 active users on a small server.
