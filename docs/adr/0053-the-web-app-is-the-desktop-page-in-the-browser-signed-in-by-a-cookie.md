# 0053. The web app is the desktop page in the browser, signed in by a cookie

- Status: Accepted
- Date: 2026-11-01

## Context

The [requirements](../requirements.md#apps-and-deployment) ask, in
Phase 3, for a web app: "Full editor in the browser, served by the server;
installable as a PWA". The roadmap asks for its content security policy,
its sessions in a cookie with a CSRF defence, and the link to sign in by
email, which [ADR 0033](0033-sign-in-by-email-with-a-code-and-the-link-with-the-web-app.md)
left for it.

The desktop app is a web page in MyGO's window
([ADR 0004](0004-desktop-on-mygo.md)). Everything it does reaches the
system through one interface, its backend: the Go services and SQLite in
the app, or a sample vault in memory in the browser preview the end-to-end
tests run. A vault is files and an index, SQLite with FTS5
([ADR 0007](0007-vault-folder-and-local-index.md)).

Browsers give a site a private file system (OPFS): real files, fast, kept
until the site's data is cleared. SQLite's own WebAssembly build
(Apache-2.0, kept by the SQLite team) runs with FTS5 on it, in a worker,
without cross-origin isolation, through its `opfs-sahpool` store.

The server signs in with bearer tokens
([ADR 0032](0032-sessions-are-bearer-tokens-and-accounts-come-by-invitation.md)),
which a page would have to keep where its scripts can read them.

## Decision

**The web app is the desktop page, built for the browser with a third
backend, `web`.** `apps/web` builds it from the desktop app's sources with
an entry of its own, and the server serves it from `/`. A vault in it is
one of the account's workspaces on that server, kept in the origin's
private file system, its notes and files in a folder for each workspace
and its index in SQLite's WebAssembly build in a worker. It syncs as the
desktop app does, so it works offline once opened and merges when back.
Its build shows sync always: a web app is its server's. What a browser
cannot do it leaves out, as system folders; exports download.

**Sessions in a browser are cookies.** Signing in with
`X-Nether-Session: cookie` sets the session's token in an `HttpOnly`,
`SameSite=Strict` cookie, `Secure` over HTTPS and on this machine, and
leaves it out of the answer. A second cookie, which the page reads, holds
a random value it sends back as `X-Nether-CSRF` with every request that
changes anything (double submit): another site can make the browser send
the cookies, but not read that value. Sockets for sync and the relay take
the cookie only from the server's own pages, as their `Origin` says,
since a socket has no such header. Signing out takes the cookies off.
Bearer tokens stay for the desktop app and scripts, unchanged.

**The sign-in email links to the web app**, where the server knows its
public address: `<address>/sign-in#email=…&code=…`, the code after the `#`,
which browsers never send, so it is in no server's or proxy's log.

**The page's content security policy** allows its own scripts and
workers, WebAssembly, connections to its own origin, and images and media
from its own origin, `blob:` and `data:`; no inline scripts, no frames.

**Installable**: a web manifest, and a service worker that keeps the app's
files, so it opens offline.

## Alternatives

- **A separate web client**: two interfaces to build and keep alike.
- **The index in IndexedDB**: search would need an engine of its own in
  JavaScript; SQLite gives the desktop app's index and search.
- **Bearer tokens in the page's storage**: any script that ran in the page
  could take the session; an `HttpOnly` cookie it cannot read.
- **A CSRF token from the server per session**: the same defence, with a
  table to keep; double submit needs none, as the page's own origin is the
  only one that reads its cookie.

## Consequences

- One interface for desktop and web, tested once.
- The web app downloads SQLite's WebAssembly, about 1 MB, the first time.
- A browser that clears the site's data loses what was not yet synced.
- Over plain HTTP to another machine, the cookies are not `Secure`; the
  self-hosting guide asks for HTTPS.
