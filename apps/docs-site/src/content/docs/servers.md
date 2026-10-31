---
title: Servers and signing in
description: How to connect the Nether app to a Nether server and sign in with a password, a code sent by email, or your organization's single sign-on.
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

## For admins

The server's README covers running a server, its first-run setup, email,
and single sign-on. A self-hosting guide comes with the server's
`docker compose` setup.
