# 0050. The server searches what it can read, indexed as notes are stored

- Status: Accepted
- Date: 2026-11-01

## Context

The [requirements](../requirements.md#search) ask, in Phase 3, for
workspace search on the server: everything a person may open, across the
workspaces they belong to, respecting permissions. Search on a device
already covers the vault it holds, offline, through SQLite's FTS5
([ADR 0007](0007-vault-folder-and-local-index.md)); the server's search is
for what a device does not hold: other workspaces, and the web app, which
keeps no index of its own.

The server keeps each note as a Yjs state in `documents`, and each sync
unit's paths in its vault document
([ADR 0037](0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md),
[ADR 0042](0042-spaces-and-shared-pages-are-sync-units-each-with-its-own-vault-document.md)).
An end-to-end encrypted workspace never reaches it in plain text
([ADR 0038](0038-encrypted-workspaces-seal-a-key-to-each-member-and-relay-updates-the-server-cannot-read.md)).
The [architecture](../architecture.md) chooses PostgreSQL's full-text
search by default, with no other service.

## Decision

**A table of what search reads**, `note_search`, one row a note: its
workspace, path and title, its text, its tags and its properties, and a
`tsvector` of the title, weighted first, and the text. The `simple`
configuration folds case and stems nothing, so every language searches
alike.

**Indexed as notes are stored**, in the transaction that stores them, so
the index never falls behind or ahead of `documents`:

- A note's state is read without the editor: the text of its content
  fragment, a line a block, its `properties` map, and its tags, those of
  its `tags` property and the `#tags` in its text, as Obsidian reads them.
- A vault document's paths are compared with the state it replaces, and
  only the notes added, moved or removed are written: on 50,000 notes, a
  rename writes one row. A note gone from its unit's list keeps its row,
  without a path, which search leaves out.
- Comments are not searched.
- What was stored before the index existed is indexed once, as the
  server starts after the migration.

**Search**, `GET /api/search?q=`, reads a query as the app does
(`@nether/search`): words, the last one as a prefix, "phrases", `-words`,
and `tag:`, `path:` and `prop:` filters, each `-`able. It searches every
workspace the account is a member of and the server can read, and in each,
only the notes of the units the account may open, by the same rule sync
uses; a guest finds only the pages shared with them. Results come ranked,
title matches first, at most 50, each with a snippet whose matches are
marked by ranges, not HTML. Encrypted workspaces are named in the answer
as not searched, so the app can say so.

## Alternatives

- **Meilisearch** beside the server: better typo tolerance and ranking,
  but another service to run, which the architecture leaves optional; an
  adapter can come later behind the same endpoint.
- **Indexing after storing, in the background**: stores return sooner,
  but the index lags, and a crash between the two leaves it wrong until a
  rebuild. A note's text takes under a millisecond to read.
- **Reading the notes as Markdown with the editor's schema**: exact, but it
  brings the editor and ProseMirror into the server; search needs words,
  not formatting.

## Consequences

- Encrypted workspaces are searched on devices alone.
- Storing a vault document reads its state twice, the new and the old.
- The server depends on `@nether/search`, the parser the desktop app uses,
  so a query means the same in both.
