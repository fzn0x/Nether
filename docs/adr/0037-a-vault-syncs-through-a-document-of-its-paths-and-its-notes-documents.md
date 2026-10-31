# 0037. A vault syncs through a document of its paths and its notes' documents, by what each device last agreed

- Status: Accepted
- Date: 2026-10-31

## Context

[ADR 0003](0003-sync-yjs-hocuspocus.md) syncs each note as a Yjs document,
with one more document per vault that lists its notes, so a note made,
moved or removed on one device follows on the others.
[ADR 0035](0035-the-server-syncs-through-hocuspocus-beside-its-api-and-numbers-each-store.md)
runs the server's side: documents named by workspace, numbered at each
store. This record decides the client's side, in `packages/sync-client`,
which the desktop app uses next and the web and mobile apps later.

Several forces shape it:

- **Size.** A vault may have 50,000 notes. A device cannot open each
  note's document each time it connects.
- **Offline.** A device away for a week, edited the whole time, must send
  its edits when it is back, and take others'. Removing a note on one
  device must not be mistaken for making it on the other.
- **Duplication.** A Yjs document made from a file twice, on two devices,
  holds two histories of the same text, and merging them doubles every
  paragraph. A note's text must therefore start from the file once, on
  the device that first sends it, and come from the server's document
  everywhere else.
- **One document per note.** On the desktop, the editor and sync must
  share a note's single document, which the app's open notes now hand out.

## Decision

**The vault document lists notes by ID.** Its map `notes` holds each
note's ID and its path, from which its title follows, as on disk.

- Moving a note changes its path.
- Removing a note removes it from the list. Other devices then send theirs
  to the trash, where it can be restored.
- A note's text is in its own document, named by its ID.

**Each device keeps a base, and compares three sides.** The base is the
paths this device and the server last agreed on. Comparing the vault's
notes and the server's list with it:

| A note… | Is |
| --- | --- |
| here and not there, not in the base | made here: listed, and its document sent |
| there and not here, not in the base | made elsewhere: fetched, and made here |
| here, missing there, in the base | removed elsewhere: sent to the trash here |
| there, missing here, in the base | removed here: taken off the list |
| removed on one side and moved on the other | kept, at its new path, since losing a note is worse than keeping one |
| moved on one side | moved on the other |
| moved on both | goes where the server has it, so every device agrees |

**The engine, `VaultSync`, syncs over one WebSocket.**

- It syncs the vault document for as long as the vault is open.
- It syncs a note's document when the note changes here, or when the
  server says it was stored elsewhere. On the server's own words, it
  syncs only notes this vault has.
- It syncs a few notes at a time, never the same note twice at once.
- Back from being away, it lists the documents stored since the last
  number it saw, and syncs those of its notes.
- It holds a note's document through the app, so a note open in the
  editor syncs the document the editor has.
- A note made elsewhere is fetched into a document first. The app makes
  the note from that document's state, then writes its file from it.
- A sync is done once the server has this side's changes as well as this
  side the server's.

**A device keeps what it knows between runs** (`SyncStore`):

- the base;
- the last number seen;
- the notes changed here and not yet sent;
- the vault document.

So the list works offline, and offline edits are sent on reconnect.

**The engine knows a vault only through `SyncVault`:** its notes' paths,
holding their documents, and making, moving and removing notes. The
desktop app gives its vault and its open notes; the web and mobile apps
will give their own stores.

**Linking is one-way at first.** A vault is linked to a workspace only
while the workspace has no notes, and the first device sends its notes'
documents, each made once from its file. Every other device opens the
workspace into an empty folder, and every note comes from the server.
The desktop app enforces this.

## Alternatives

- **Each note's path inside its own document.** A device away would need
  every note's document to learn which were moved or removed. That is the
  50,000 documents again.
- **One document for the whole vault, text and all.** Every device would
  load every note's history to edit one, and a vault's document would
  grow without end.
- **Two sides compared without a base.** A note missing on one side could
  be made on the other or removed on this one. Without the base there is
  no telling which, and guessing wrong loses or resurrects notes.
- **Syncing every note on connect.** It is simple and always right, but
  50,000 handshakes for a few changes.
- **Merging two vaults that both have notes.** Their notes have different
  IDs, so the same note on two devices would become two, each with its own
  history. A later import could match notes by path and content, if people
  need it.

## Consequences

- Sync is as fast as the server's store: two seconds after the last edit,
  at most ten while typing goes on. Real-time co-editing, later in this
  phase, keeps a provider on the open note for keystroke latency.
- After a device sends its notes, the next catch-up lists them as stored,
  and the device syncs each once more, with nothing to send. It is a cost
  once, after linking.
- Two notes made at one path on two devices, offline, are both kept. The
  app makes the second at a free path beside the first.
- End-to-end encrypted vaults, the next item, encrypt the documents'
  updates on their way through this engine.
