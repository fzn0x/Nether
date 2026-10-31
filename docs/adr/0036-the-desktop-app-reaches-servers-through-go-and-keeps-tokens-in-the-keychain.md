# 0036. The desktop app reaches servers through Go, and keeps their tokens in the system's keychain

- Status: Accepted
- Date: 2026-10-31

## Context

The server signs people in with a password, an emailed code or an OpenID
Connect provider, and gives a bearer token
([ADRs 0032 to 0034](0032-sessions-are-bearer-tokens-and-accounts-come-by-invitation.md)).
Before the desktop app can sync
([ADR 0035](0035-the-server-syncs-through-hocuspocus-beside-its-api-and-numbers-each-store.md)),
it has to sign in. Three questions follow.

**How does the page reach a server?** The desktop app's page runs in a
WebView, at the app's own origin. A `fetch` from it to a server at another
origin is subject to CORS: the server would have to allow that origin,
which differs between systems and versions of the WebView. A WebSocket is
not, but cannot send an `Authorization` header.

**Where does the token live?** A session lasts up to 90 days. In
`localStorage` or a settings file, any process able to read the user's
files can copy it.

**How does a provider's sign-in come back?** ADR 0034 has the server send
the browser to a loopback address of the app. The page cannot listen on a
port.

## Decision

**Requests to a server go through Go.**

- MyGO's `fetch` plugin (`@mygo-plugins/fetch`, MIT) makes the page's
  requests to a server from Go's HTTP client. It is the standard `fetch`
  API, outside the page's CORS.
- The backend gives the page `serverFetch`: that one in the desktop app,
  and the browser's own in the preview, where the end-to-end tests stand
  in for the server.
- The server's API needs no CORS for the desktop app. The web app, served
  by the server itself, is at its origin.
- Sync's WebSocket comes the same way, with MyGO's WebSocket plugin, in the
  next pull request.

**Each session's token is kept in the system's keychain.**

- A Go service, `Servers`, keeps the servers signed in to, with their
  accounts (an address, a name and an email address), in `servers.json`
  beside the list of vaults. Each token goes, by the server's address, in
  the system's keychain through `mygo.Secrets`:
  - the Keychain on macOS;
  - the Credential Manager on Windows, encrypted for the user;
  - the Secret Service through libsecret on Linux (GNOME Keyring, KWallet,
    KeePassXC).
- A token is never written to a file or to a vault.
- Signing out ends the session on the server when it can be reached, and
  forgets the token here either way.

**Go waits on a loopback address for a provider's sign-in.**

- `Servers.Listen` opens `http://127.0.0.1:<port>/<secret>`, by IP as RFC
  8252 asks, and `Servers.Wait` gives the page the query the browser comes
  back with.
- The page meanwhile starts the server's flow with that address and a PKCE
  challenge, and opens the provider in the system's browser.
- The listener answers only that path, on that host name, once. It shows a
  page, with a content security policy that allows nothing, telling the
  person to go back to the app.
- It stops after ten minutes, or when the page cancels.
- A code taken from that request is no use without the page's PKCE
  verifier.

**The dialog.** **Servers and signing in**, in the command palette, lists
the servers signed in to. It connects to another by its address
(`https://` when none is given) and offers what the server does: a
password, a code by email, or "Sign in with" its provider. Its strings are
in the messages, as every string of the app.

## Alternatives

- **CORS on the server for the desktop app's origin.** That origin is a
  custom scheme or a local host that differs by system and WebView, and
  allowing it would also allow any page that copies it.
- **The token in `localStorage`, or in `servers.json`.** Any process
  running as the user could read it from the WebView's profile or the
  file. The keychain at least asks, or encrypts it, by system.
- **A custom URL scheme for the provider's return.** It needs registering
  per system, any app can claim it, and RFC 8252 prefers a loopback address
  for desktop apps.
- **Sign-in in an embedded window.** A provider's page inside the app
  cannot be told apart from a fake one, and providers such as Google refuse
  embedded browsers. RFC 8252 asks for the system's browser.

## Consequences

- On a Linux desktop without a Secret Service, as some minimal window
  managers have, the app cannot keep a session, and says so when it signs
  in. Revisit with an encrypted file then, if people ask for one.
- The page has the token in memory while it uses it, as it must to send
  it.
- The next pull request links a vault to a workspace, and syncs its notes
  with the token through MyGO's WebSocket.
