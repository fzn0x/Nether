# 0044. A note's comments are a document of their own beside it

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#collaboration) ask for comments and
threads: "Comment on any text range or block; reply, resolve, reopen". A
workspace's levels already include **Can comment**
([ADR 0042](0042-spaces-and-shared-pages-are-sync-units-each-with-its-own-vault-document.md)),
which until now synced a unit's notes read-only.

Comments must work as notes do: offline, merged when two people comment at
once, and end-to-end encrypted in an encrypted workspace. Where to keep
them decides who may write them:

- **In the note's file**, as `%%comments%%` or footnotes, every other app
  shows them in the text, and every comment changes the file.
- **In the note's document**, whoever comments must be able to write the
  note's document, and so its text: Hocuspocus lets a connection write a
  whole document or none of it.
- **On the server, through its API**, comments neither work offline nor
  stay unreadable to the server in an encrypted workspace.

## Decision

**Each note's comments are a Yjs document of their own beside the note's.**

- On the server it is `<workspace>/<note>.comments`, in the note's unit:
  listed, opened and refused as the note is. Those who may comment, or
  more, write it; those who may view read it. The server keeps no
  versions of it: a note's history is its text's.
- On a device it is kept in the vault's index under `<note>.comments`,
  beside the note's document, and deleted with it when the note leaves
  the trash for good. It has no file: comments are about a note, not in
  it, and the note's Markdown stays the note's alone.

**A thread is anchored to a range of the note's document.** The comments
document holds a map, `threads`, of each thread by its ID (a UUID version
7). A thread holds:

| Field | What it is |
| --- | --- |
| `start`, `end` | The range's ends, Yjs relative positions in the note's document, encoded |
| `block` | The ID of the block the range began in |
| `quote` | The text commented on, as it was then |
| `created` | When it was started |
| `comments` | Its comments in order, each with `id`, `author` (an account's `id` and `name`), `body` (plain text), `created` and, once changed, `edited` |
| `resolvedBy`, `resolvedAt` | Who resolved it, and when, while it is resolved |

Relative positions follow the text through everyone's edits. Where the
text commented on is gone, the thread falls back to its block, and where
the block is gone too, it shows its quote alone.

Whoever may comment starts threads, replies, resolves and reopens. The app
offers to edit and delete only one's own comments; the server, which
stores the document whole, cannot check inside it. A thread whose last
comment is deleted goes with it.

**Comments sync as notes do, in rounds.** A comment made on a device marks
the note's comments to sync; the server's notice of each store, and its
list of what is stored, bring the others'. A note with no comments, here
or on the server, is not synced for them. A note fetched from the server
fetches its comments too, as they may have been stored before this device
could see them, as when a teamspace has just been opened to it. In an
encrypted workspace they go through the relay, encrypted like notes.

## Alternatives

- **One comments document per workspace or unit.** Every device would
  load every comment to show one note's, and the document would only grow.
- **A table of comments on the server.** Comments would stop working
  offline, and in an encrypted workspace the server would read them.
- **Anchors as block IDs and offsets.** An offset is wrong after the first
  edit before it; relative positions are Yjs's own answer, and the block
  and the quote remain for when the text is gone.

## Consequences

- A member who may comment writes comments, never the note's text.
- Commenting works offline and merges like notes, replies made at once
  are both kept, and an encrypted workspace's comments stay unreadable to
  the server.
- The first sync of a vault from a server asks for each note's comments
  as well as the note, so it makes twice the requests, most of them for
  nothing.
- A note's Markdown leaves its comments out. So that they can still leave
  Nether in an open form, exporting notes writes their threads as JSON
  beside the Markdown, from when the app shows comments.
