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
