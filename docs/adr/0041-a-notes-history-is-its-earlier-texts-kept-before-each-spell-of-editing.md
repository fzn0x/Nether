# 0041. A note's history is its earlier texts, kept before each spell of editing

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#storage-sync-and-offline) ask for
version history: "Browse and restore any previous version of a note, with
a diff view; retention configurable by the admin".

Several forces shape it:

- **Offline and alone.** The desktop app works with no server
  ([ADR 0007](0007-vault-folder-and-local-index.md)), and history is
  most wanted when something went wrong, often on that computer.
- **Encryption.** An encrypted workspace's server cannot read a note
  ([ADR 0038](0038-encrypted-workspaces-seal-a-key-to-each-member-and-relay-updates-the-server-cannot-read.md)),
  so it cannot keep readable versions of one.
- **The document is not the history.** A note's Yjs updates are compacted
  into a snapshot every hundred rows, and a Yjs document that kept every
  deleted character to go back to would grow without end.
- **What people read.** A note is Markdown. A version that is Markdown text
  can be compared line by line, and put back as it was written.
- **Admins.** The requirement names an admin's retention, which is the
  server's: a self-hoster decides how long the server keeps old versions.

## Decision

**A version is a note's Markdown text, with the time the note last had
it.** Each device keeps the versions of the notes it writes, in its index
(SQLite on the desktop, schema 8, `note_versions`), outside the vault, as
the index is.

**A version is kept before each spell of editing.** When Nether writes a
note whose last version is older than ten minutes, it first keeps the text
the write replaces. The history so has the note as it was before each
spell of editing, and every ten minutes while one goes on. A write that
fails because the file changed keeps nothing, and neither does one that
changes no text. Edits from sync are written the same way, so they are in
the history too.

**Differences are shown line by line.** Nether diffs two texts with Myers'
algorithm (`diffLines` in `@nether/markdown`, no dependency): the fewest
lines removed and added, with the lines both start and end with set aside
first. The history shows what changed from a version to the note now,
removals with a minus and additions with a plus besides their color, and
folds long runs of unchanged lines, keeping three beside each change, when
folding hides more than one line.

**Restoring goes through the note's document.** The version's text goes in
as source mode's text does: written to the file, and merged into the
document the editor and sync share, so a restore is an edit like any
other, and syncs. The note as it is just before is kept as a version
first, so a restore is undone the same way.

**Each device sets how long it keeps versions.** Thirty days unless set in
the history; older versions are deleted when the vault opens.

**The server keeps versions for the workspaces it can read.** When sync
stores a note whose last version there is ten minutes old, the server
keeps the Yjs state the store replaces, in the same transaction
(`document_versions`, schema 8), so the server's history has every
device's edits. It keeps them as long as its admin sets with
`NETHER_HISTORY_DAYS`, 30 days unless set, and deletes older ones when it
starts and every hour. Members list a note's versions and fetch each as a
state; the desktop app shows them as Markdown beside its own for a synced
note, each marked with where it is kept. An encrypted workspace's history
stays on each device, as its server cannot read a note.

## Alternatives

- **Yjs snapshots, with garbage collection off.** Any moment could be
  shown, but documents would keep every deleted character forever, and
  a snapshot still has to become Markdown to be read.
- **A version on every save.** A save comes every few seconds while typing,
  and a history of hundreds of versions a day is no help to anyone looking
  for the note as it was this morning.
- **The text of the new version, rather than the one replaced.** The note
  as it was before the first edit after a pause, which is what people come
  back for, would be lost.
- **A diff library.** `diff` (BSD-3-Clause) is sound, but the history needs
  only lines, and Myers' algorithm is a hundred lines tested against a
  plain longest-common-subsequence count.
- **Versions in the vault, as files.** They would travel with the folder,
  and fill other apps' views, search and sync with copies of every note.

## Consequences

- History works with no server and in encrypted workspaces, where each
  device sees only the versions it kept.
- A synced note has two histories, which overlap: this device's and the
  server's. The server's holds edits made elsewhere; this device's holds
  what it wrote while offline.
- Deleting the index, which was always safe, now loses this device's
  versions.
- A note edited by another app is not kept as it was before that app's
  edit; Nether keeps its text before Nether's next write.
