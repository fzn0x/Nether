# 0040. Attachments sync by path and hash in the vault document

- Status: Accepted
- Date: 2026-10-31

## Context

A vault syncs through the vault document, which lists its notes by ID and
path, and each note's own Yjs document
([ADR 0037](0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md)).
Its other files did not sync: the images, PDFs, audio and video notes
embed, and files such as the Obsidian base beside each database. The
server keeps such files by the SHA-256 of their bytes, once per workspace
([ADR 0039](0039-attachments-are-kept-by-their-hash-on-disk-or-in-an-s3-bucket.md)).

Several forces shape how they sync:

- **No IDs.** A note has an ID in its index, kept across moves. A file has
  only its path, and another app may move or replace it at any time.
- **Whole files.** An image's bytes do not merge. Two computers changing
  one file offline make two versions, and neither may be lost.
- **Size.** Files are large, and the same one is often in several places.
- **Encryption.** An encrypted workspace's files must stay unreadable to
  the server
  ([ADR 0038](0038-encrypted-workspaces-seal-a-key-to-each-member-and-relay-updates-the-server-cannot-read.md)).
- **Trust.** A member's device writes the files another member lists. A
  list naming `.obsidian/plugins/x/main.js` would put code where Obsidian
  runs it.

## Decision

**The vault document lists files by path.** Beside its map of notes, a
`files` map gives each file's path its hash (the SHA-256 of its bytes) and
its blob (the name the server keeps the bytes under). A move is a removal
and an addition of the same hash, whose bytes are not sent again.

**Files are compared three ways, like notes.** A device keeps the paths
and hashes it and the server last agreed on. A file made, changed or
removed on one side is made, changed or removed on the other. A file
removed on one side and changed on the other is kept, as changed. A file
changed on both sides, or made at one path on both, is kept twice: the
server's at its path, and this computer's moved beside it, as
`map 1.png`, then sent. The agreed list changes only for files the two
agree on, so a file whose sending failed is not later taken for one made
or removed.

**Bytes go once per workspace.** A file whose hash the list has already
takes that blob. Otherwise its bytes are sent after a `HEAD` asks whether
the server has them, and listed only once the server has them. A file
another path here has is copied rather than fetched. Fetched bytes are
checked against the hash before they are written, with the hash of the
file there as the write's base, so a file changed meanwhile is not
overwritten.

**An encrypted workspace's files are encrypted with a nonce derived from
their bytes.** The format is the one updates have,
`[format][key version][nonce][ciphertext]` with XChaCha20-Poly1305, but
the nonce is a BLAKE2b hash of the bytes keyed by a key derived from the
workspace's. The same file encrypts the same way, so it is still kept
once; only members can tell which file it is. The blob is named by the
hash of the ciphertext, and the plaintext's hash is listed only in the
encrypted vault document.

**Only files every system can write sync.** A path from either side syncs
only if it is not a note, has no hidden part (`.nether`, `.obsidian`,
`.trash`), and no character or name Windows refuses. Anything else is
passed over.

**Refusals are named, not repeated.** A file the server refuses, larger
than it takes or sent by a guest, is not sent again until it changes,
and the status names it; the desktop app's sync line says which.

## Alternatives

- **An ID per file, in a sidecar or the index.** Moves would be moves,
  but the ID would not survive another app moving the file, and files
  would need a format Obsidian does not know.
- **The server's file wins a conflict.** Simpler, and it loses a version
  someone made.
- **Random nonces for encrypted files.** They reveal nothing, not even
  that two uploads are one file, but every device would send the same
  file anew, and a retry would store it twice.
- **Files in their own Yjs documents.** Yjs merges text, not bytes, and
  its history would keep every version of every file.

## Consequences

- Files sync with notes, last in each round, so a large file does not
  hold up notes.
- A file renamed on one computer and changed on another is kept twice,
  at both paths.
- A file on the server that no list names stays stored; collecting them
  comes with version history and backups.
- The vault document grows a little: one entry per file.
