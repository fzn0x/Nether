---
title: Servers and signing in
description: How to connect the Nether app to a Nether server, sign in with a password, a code sent by email, or your organization's single sign-on, and sync a vault between computers.
---

Nether works without a server: a vault is a folder of Markdown files on your
computer. A Nether server, which you or your organization runs, adds sync
between devices, sharing and collaboration. The app signs in to it first.

## Connecting to a server

Run **Servers and signing in** from the command palette (Ctrl+P, or Cmd+P on
macOS), and type the server's address, such as `nether.example.org`. Nether
uses `https://` unless the address says otherwise. The server tells the app
how you may sign in:

- **Password**: your email address and the password of your account.
- **Email me a code**: the server emails you a code of eight digits, which
  works once, within 15 minutes. It appears when the server's admin has set
  up email.
- **Sign in with …**: your organization's single sign-on, such as Keycloak,
  Okta or Microsoft Entra ID. The app opens it in your browser; once you
  have signed in there, the browser comes back to the app, and you can close
  the page it shows.

Accounts come by invitation from a workspace's owner or admin, so ask them
for one if the server says it has none for you.

## Where the app keeps your sign-in

The app keeps the servers you have signed in to and their accounts in its
settings, and each session's key in your system's own keychain: the
Keychain on macOS, the Credential Manager on Windows, and the Secret
Service, as GNOME Keyring or KWallet, on Linux. It is never written to a
vault or another file.

A session lasts 30 days without use and 90 days in all; after that, sign in
again. **Sign out** ends the session on the server and removes it from the
app; if the server cannot be reached, the app forgets it anyway.

## Syncing a vault

Open the vault, run **Sync this vault** from the command palette, and
choose a server you are signed in to and one of your workspaces. The vault's
notes go to the workspace, and a line at the foot of the sidebar tells how
sync is going: synced, notes still to send, or offline, when changes wait
on your computer until it is back.

To have the vault on another computer, open an empty folder there as a
vault, run **Sync this vault**, and choose the same workspace: every note
comes from the server with its links, properties and history.

A vault syncs with a workspace that has no notes, or into a vault that has
none, so no note is ever made twice. Each note's text merges character by
character, so two computers editing one note, even offline, keep both
edits, with no conflict to resolve. A note moved or removed on one computer
is moved, or sent to the trash, on the other. **Stop syncing** keeps the
notes where they are, on the computer and on the server.

The vault's other files sync too: images, PDFs, audio, video and the
like, each sent to the server once however many notes or folders have it.
Their bytes cannot merge, so when two computers change the same file
before syncing, both versions are kept: the one the server had first at
its place, and the other beside it, as `map 1.png`. Hidden folders, such as
`.obsidian`, stay on each computer. A file larger than the server takes,
100 MB unless its admin sets otherwise, stays on your computer, and the
line at the foot of the sidebar names it.

## Members and invitations

**Workspace members**, in the command palette, lists the people in the
workspace the vault syncs with, and each one's role:

- **Owners** do everything, including making other owners and admins. A
  workspace always keeps one.
- **Admins** invite people and change or remove members and guests.
- **Members** read and write every note.
- **Guests** only read.

To invite someone, owners and admins choose their role and, if only they
should be able to accept, their email address, then **Make an invitation
link**. Send them the link: it works once, for 7 days, and **Withdraw**
stops it sooner.

To join with a link you were sent, open **Servers and signing in**, choose
**Join with an invitation** and paste it. You see which workspace and role
it is for, then join with the account this computer is signed in to on that
server, or make one there. Then open an empty folder as a vault, and **Sync
this vault** with the workspace to fetch its notes.

**Leave the workspace** takes you out of it. The vault keeps its notes and
stops syncing.

## Editing together

When others have a note open that you have open too, each edit reaches
everyone as it is made. Their carets show in the note, each a line in a
color of their own with their name above it, and the text they select is
tinted the same. Your name is your account's on the server.

In an encrypted workspace, edits come a few seconds apart, as they do for
notes no one has open, and no carets show yet.

## Comments

In a vault that syncs with a workspace, you can comment on a note's text:

- Select the text and press **Ctrl+Alt+M** (**Cmd+Option+M** on a Mac), or
  run **Comment on the selection** from the command palette. With nothing
  selected, the comment is on the block the caret is in. A block's menu,
  beside it, has **Comment** too.
- Write the comment in the box that opens in the **Comments** panel beside
  the note, then click **Comment** or press **Ctrl+Enter**.
- The text commented on is tinted in the note. Click it to show its thread,
  or click a thread's quote to show its text in the note.
- Reply to a thread from its box, and **Resolve** it once it is settled:
  it folds away under **Resolved**, where **Reopen** brings it back. You
  can edit and delete your own comments.

A thread follows its text as anyone edits the note. If that text is
deleted, the thread stays on its block. Comments sync with the note, even
when you comment offline, and in an encrypted workspace they are encrypted
too. They are not in the note's Markdown file, which holds only the note.
Those who **Can comment** on a space or page comment on its notes without
changing them; those who **Can view** read the comments.

### Mentions and notifications

Type **@** in a comment to mention someone in the workspace: a word of
their name narrows the list, and the arrow keys and **Enter**, or a click,
pick them. They are told in Nether, and by email when the server sends
email. Only those who may open the note are told. A mention made offline
is sent once you are back online.

**Notifications**, at the foot of the sidebar or in the command palette,
lists who mentioned you and where, the new ones marked. Choose one to open
its note and thread, or **Mark all as read**. Clear **Email me when
someone mentions me** there to get no more emails. In an encrypted
workspace, a notification and its email say only who mentioned you, and
in which workspace.

## Spaces and sharing

A workspace's notes are in spaces, which **Spaces**, in the command palette,
lists:

- **General** holds every note in no other space, and every member opens
  it.
- A **teamspace** is a folder at the top of the vault, opened by the
  members its makers add, each with **Full access**, **Can edit**, **Can
  comment** or **Can view**. Naming a new teamspace after a folder you
  have makes that folder the teamspace's: its notes leave General, and
  only the teamspace's members still open them. Those with full access add
  and remove its members, rename it, which renames its folder in every
  member's vault, and delete it once it is empty.
- Your **private space** is the `Private` folder, which only you open.

A note moved into a space's folder joins that space, and leaves the vaults
of those who do not open it.

**Share this page**, with a note open, shares it on its own, with its
subpages, the notes in the folder beside it. A page shared on its own
keeps everyone who opens the space it is in, unless you choose **Only the
people below**. Those with full access give members access to it, and
invite a guest by a link: a guest opens the pages shared with them, and
nothing else of the workspace. **Stop sharing it on its own** puts it back
with its space.

An encrypted workspace has no spaces or shared pages yet: everyone in it
opens all of it.

## End-to-end encryption

A workspace can be encrypted, so that only its members' computers can read
its notes: the server keeps them and syncs them, but holds
nothing it can read, not even their titles. Encryption is chosen when a
workspace is made, and stays.

**Turn it on** once for your account: in **Servers and signing in**, choose
**Turn on end-to-end encryption**. Nether shows a recovery phrase of 24
words. Write them down, in order, and keep them somewhere safe: they are the
only way to open your encrypted workspaces on a new computer, and no one,
not the server's admin nor Nether's makers, can recover them for you.

**Make an encrypted workspace** in **Sync this vault**: give it a name and
choose **Make it encrypted**, then sync the vault with it.

**On another computer**, sign in to the server, choose **Unlock with the
recovery phrase**, and type the 24 words. Your encrypted workspaces then
sync there as the others do.

**Members** of an encrypted workspace get its key from another member's
computer, sealed so only theirs can open it, the first time a member who
has it opens Nether after they turn encryption on. Until then, their sync
waits for it.

The server cannot search an encrypted workspace, publish it, or keep its
history; those come from the apps that can read it.

## For admins

The server's README covers running a server, its first-run setup, email,
and single sign-on. A self-hosting guide comes with the server's
`docker compose` setup.
