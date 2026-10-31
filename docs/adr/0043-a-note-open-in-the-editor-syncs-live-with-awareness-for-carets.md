# 0043. A note open in the editor syncs live, with awareness for carets

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#collaboration) ask for real-time
co-editing: "Several users edit the same note at once with live cursors
and selections; latency under 200 ms on the same region".

A note's document syncs in rounds
([ADR 0037](0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md)):
a round attaches a provider for each note changed on either side, syncs
it and lets it go. Another person's edit so arrives only when this device
next runs a round for that note, after the server has stored it, seconds
later. Nothing tells anyone where the others are in a note.

Hocuspocus keeps a document's connections in step as each update comes,
and carries an awareness: what each client says about itself, as its
caret, to the others in the same document. TipTap's collaboration caret
extension (MIT) draws the others' carets and selections from it.

## Decision

**A note open in the editor syncs live.** While its editor is open, the
desktop app asks the sync engine for the note live
(`VaultSync.live(id, document, editor)`).

- The engine opens a Hocuspocus provider of its own for the note's
  document on the shared socket, and keeps it until the editor closes.
  Each edit goes to the server, and from it to everyone with the note
  open, as it is made.
- The engine opens it only once a vault document lists the note, so a
  note just made goes live after the round that places it in its unit
  ([ADR 0042](0042-spaces-and-shared-pages-are-sync-units-each-with-its-own-vault-document.md)),
  and the server checks the right unit.
- A note wanted live skips rounds. A round's provider for the same
  document beside the live one would clash on the socket. When the editor
  closes, the note waits for the next round, rather than starting one
  beside the live provider's close.

**A note's provider signs in once the last one for it has gone.** On one
socket, a provider for a note signs in only half a second after the last
one for that note was let go: a sign-in the server takes before it has
closed the last one is never answered. A live provider not let in within
five seconds while connected asks again, and a round's sync not let in
within twenty fails, for the next round, rather than waiting for ever.

**Awareness shows who is where.** The engine makes the note's awareness
up front, with who is editing: the account's name, and a color from its
ID, the same on every device, each dark enough for white text. The editor
adds the collaboration caret extension on that awareness: each other
person's caret is a line in their color with their name above it, and
their selection is tinted the same.

**An encrypted workspace's notes stay in rounds, for now.** Its relay
carries encrypted updates, not awareness; live sync there needs encrypted
awareness and a relay subscription kept open, which come later.

## Alternatives

- **Shorter rounds.** Rounds every second would still miss the 200 ms
  target, and attach and let go a provider each time, for every note.
- **Every note live.** A vault of thousands of notes would keep thousands
  of providers open, where people edit a handful at once.
- **A separate presence channel.** Awareness already travels with the
  document's provider, which Hocuspocus and the caret extension both use.

## Consequences

- Locally, an edit reaches another device's open note in tens of
  milliseconds.
- Edits made while the note is open reach the server as they are made, so
  the server stores them in the usual way, and versions
  ([ADR 0041](0041-a-notes-history-is-its-earlier-texts-kept-before-each-spell-of-editing.md))
  keep working.
- The editor is made again when live sync starts, a moment after the note
  opens; its content is the document's, and stays.
