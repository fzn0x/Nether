# 0042. Spaces and shared pages are sync units, each with its own vault document

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#collaboration) ask for:

- teamspaces that group notes for a team, and a private space per user;
- workspace roles (owner, admin, member, guest), and per-page permissions
  (full access, edit, comment, view) that "inherit down the page tree";
- guests invited "to specific pages only".

A vault syncs through one vault document per workspace, which lists every
note by ID and path, and one Yjs document per note
([ADR 0037](0037-a-vault-syncs-through-a-document-of-its-paths-and-its-notes-documents.md)).
Every member receives that list. A page some members may not see would
still show its title and path to all of them, and a guest would see the
whole workspace's list.

The maintainer weighed three models on 2026-10-31: one listing per space,
whose restricted titles stay visible; lists the server works out per
member, which drops the vault document and its offline moves; and sync
units. The maintainer chose sync units.

## Decision

**A workspace's notes are divided into units.** Each unit has a vault
document of its own, listing its notes as ADR 0037's does, and the people
who may open it, each at a level. An app syncs only the units its account
may open, so a page it may not see is not even listed for it.

| Unit | Vault document | Holds | Who opens it |
| --- | --- | --- | --- |
| General | `<workspace>/vault`, the one every workspace has | every note in no other unit | every member but guests |
| A teamspace | `<workspace>/vault.<unit>` | the notes in a top-level folder named as the teamspace | the teamspace's members |
| A private space | `<workspace>/vault.<unit>` | the notes in its member's `Private` folder | that member alone |
| A shared page | `<workspace>/vault.<unit>` | a page with permissions of its own, and its subtree: the note `X.md` and its folder `X/` ([ADR 0013](0013-pages-in-the-folder-beside-a-note.md)) | its grants, and its parent's people unless restricted |

**Levels are full access, edit, comment and view.** Full access also
changes who may open the unit.

- In General, owners, admins and members have full access.
- In a teamspace, the member who made it has full access, and the members
  they add have the level they give.
- A private space is its member's alone, at full access.
- A shared page keeps the levels of the unit it sits in, raised by its own
  grants, unless it is restricted, when only its grants count. Inheritance
  so follows the page tree: a page inside a shared page sits in that unit.
- Guests never open General or a teamspace, only the pages shared with them.

Below edit, an app's connections to the unit's documents are read-only.
Comment comes with comments.

**Which unit a note is in is the server's record**, not the vault
documents'. A note the record does not name is in General, so existing
workspaces need no change. A note moves into or out of a unit, as one
dragged into a teamspace's folder, by a request the server checks: the
account needs edit in the unit the note leaves and in the one it enters.
The app then moves its entry from one vault document to the other. A vault
document that lists a note the record puts elsewhere grants nothing, so
someone who may only view a unit cannot claim its notes into another.

**Lists stay in step with what only the server changes.** Renaming a
teamspace moves its notes and files to the new folder in its vault
document, and a page that stops being shared on its own has its list
merged into the one where it sits before its unit goes. An app moves a
note to its path's unit unasked only into somewhere narrower, out of
General or into a shared page, so learning a teamspace's new name before
its notes' new paths sends nothing to General.

**Paths stay whole.** A note has the same path for everyone who sees it. A
guest given a page sees the folders above it in its path; they learn those
folders' names, not their notes.

**An access change applies at once.** A change closes the account's open
connections (as removing a member does), and its apps connect again,
asking for their units anew.

**Encrypted workspaces keep workspace-level access, for now.** Units there
would each need their own key, sealed to their own people. Until then, an
encrypted workspace has General alone, and its guests read all of it.

## Alternatives

- **One listing per space.** Simpler, and a restricted page's title and
  path stay visible to everyone in its space, which Notion's users do not
  expect.
- **Lists the server works out for each member.** Fully hidden, and the
  shared vault document goes, with it the offline moves and merges that
  ADR 0037 gives. Every move becomes a request queued while offline, with
  its own conflict rules.
- **Units decided by the vault documents.** Simpler for the server, and
  anyone who may view a page could list its note in a unit they edit and
  so open it to that unit's people.

## Consequences

- The sync engine syncs several vault documents and moves notes between
  them, asking the server first.
- Renaming a teamspace renames a top-level folder in every member's vault.
- A move into or out of a unit made offline waits for the server's answer.
- The work comes in steps, each a pull request: units on the server, for
  spaces and the record of notes; shared pages and guests; the engine's
  units; spaces in the desktop app; sharing in the desktop app.
