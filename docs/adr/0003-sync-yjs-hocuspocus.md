# 0003. Sync notes as Yjs documents through Hocuspocus, and keep Markdown files in step

- Status: Accepted
- Date: 2026-10-30

## Context

Nether is local-first: every client keeps working offline, and a server
only adds sync, sharing and collaboration. The
[requirements](../requirements.md) ask for:

- offline edits that merge on reconnect with no conflict dialogs for text,
  and real-time co-editing under 200 ms within a region;
- every write durable on the device before it syncs, and no data loss on
  a crash, a power cut or a network drop;
- optional end-to-end encryption per vault, with the server storing only
  ciphertext, and version history;
- on the desktop, each note mirrored to a `.md` file in the user's vault,
  with edits made by other apps picked up within 2 seconds and merged.

Notes have stable IDs that never depend on their title or path, every
block has a stable ID, and a vault is the unit of sync, permission and
encryption. [ADR 0002](0002-editor-tiptap.md) chose TipTap on ProseMirror
as the editor and remark's syntax tree for Markdown.

## Decision

### The CRDT

Every note is its own Yjs document:

| Part | Yjs type | Holds |
| --- | --- | --- |
| `content` | `Y.XmlFragment` | the editor's ProseMirror document, bound by TipTap's collaboration extension |
| `properties` | `Y.Map` | the note's properties, the frontmatter on disk; each key merges on its own |

Each vault also has one Yjs document that maps note IDs to their path,
title, parent in the page tree and position, and trash state, so renames
and moves sync like edits. A note's ID never appears in its file; the
vault document and the local store keep it.

### Storage and sync

- **Local first.** Each Yjs update is appended to the client's SQLite
  database in a transaction before the edit counts as saved, and updates
  are merged into snapshots from time to time. Only then does it sync.
- **Hocuspocus on the server.** Clients sync each note's document over
  WebSocket with Hocuspocus, which runs inside the Nether server. Its
  authentication hook checks the caller's access to the note, read-only
  for view and comment access, and its storage hooks keep updates and
  snapshots in PostgreSQL. Presence (cursors, selections) uses Yjs
  awareness, fanned out across server nodes through Redis or Valkey.
- **Offline merges.** On reconnect, Yjs exchanges state vectors and the
  missing updates in both directions. Concurrent text edits merge
  character by character; when two devices change one property at once,
  every device keeps the same one of the two values.
- **End-to-end encrypted vaults.** The client encrypts each update with
  the vault's key before it leaves the device. The server stores and
  relays the ciphertext in order without reading it, and clients compact
  the log by uploading an encrypted snapshot. Features that need the
  server to read notes, such as server search and publishing, are off for
  these vaults. Keys and the recovery phrase get an ADR of their own in
  Phase 3.

### Markdown files on disk

On the desktop the CRDT is the source of truth inside Nether, and each
note's file is kept in step with it in both directions.

**From Nether to the file.** After an edit settles (half a second of
quiet, at most two seconds), the note is written to its file: to a
temporary file in the same folder, flushed to disk, then renamed over the
old one, so a crash never leaves half a file. Only changed blocks are
serialized; every unchanged block keeps its original bytes, which the
last read or write recorded with the block's ID. The frontmatter is
written with a YAML library that keeps comments and key order. A block's
ID is written into the file, as Obsidian's `^id`, only when something
links to, embeds or comments on the block. After each write the store
records the file's size, modification time and SHA-256 hash.

**From the file to Nether.** The file watcher reports a change; Nether
reads the file and compares its hash with the recorded one. A match is
Nether's own write and is ignored. Otherwise it is an edit from another
app:

1. Parse the new file, and diff its blocks against the content Nether
   last wrote or read (the base), matching blocks by `^id` where present,
   then by content and position.
2. Turn the differences into editor transactions: changed text inside a
   block becomes character-level inserts and deletes, other changes
   become block inserts, deletes and replacements.
3. Apply them to the Yjs document as one local edit. Because they are
   edits relative to the base, anything that reached the CRDT meanwhile,
   from sync or from the editor, is merged rather than overwritten, and
   the file is rewritten from the merged document.

A removed file sends its note to the trash, where it can be restored for
30 days. A rename that the watcher reports, or a removal and a new file
with the same hash close together, keeps the note's ID and updates its
title and the links to it. Syntax that `packages/markdown` cannot map is
kept as a raw block that writes back its exact bytes, so nothing is lost.
When Nether starts, it reconciles the vault with the store by size and
modification time, hashing only the files that differ.

## Alternatives

- **Automerge.** A JSON CRDT with rich text and a full change history,
  but its ProseMirror binding and server ecosystem are younger than
  Yjs's, and the requirements do not need history at that grain.
- **Loro.** A promising Rust CRDT with rich text and a movable tree, but
  its ecosystem is the youngest of the three, with no server comparable to
  Hocuspocus.
- **Operational transformation** (ProseMirror's own collab module). A
  central authority orders every step, so devices that edit offline
  cannot merge without it, which contradicts local-first.
- **Files as the source of truth**, merged with text diffs as file sync
  tools do. No real-time co-editing, and concurrent edits to one note
  turn into conflicts.
- **`y-websocket` or y-sweet instead of Hocuspocus.** The `y-websocket`
  server leaves authentication and persistence to us; y-sweet, written in
  Rust, stores documents in S3-compatible storage, but would sit apart
  from the Node service that owns permissions. Hocuspocus is MIT
  licensed, runs in our Node service, and has hooks for authentication,
  loading and storing, and a Redis extension for several nodes.
- **Note IDs in the frontmatter.** It would make identity survive any
  file operation, but it writes into every file a key the user never
  added, and Obsidian would show it as a property.

## Consequences

- `packages/markdown` and `packages/storage` own the block source map,
  the block diff and the three-way merge. Fuzz tests apply random edits
  to the file and to the CRDT at once and check that both sides' edits
  survive, as the testing requirements ask for sync.
- Opening a large vault loads no Yjs documents up front: the index and
  search live in SQLite, and a note's document loads when it opens.
- Undo is per user, through Yjs's undo manager.
- A vault synced by another tool as well, such as a file sync service,
  can produce edits that arrive twice; the user guide must say to sync a
  vault one way only.
- End-to-end encrypted vaults trade server search, publishing and
  webhooks for privacy, and only their clients can compact their history.
- We would revisit Yjs if per-document memory or load time failed the
  performance targets at 50,000 notes.
