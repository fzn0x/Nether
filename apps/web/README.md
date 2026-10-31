# @nether/web

The Nether web app: the desktop app's page, built from its sources for the
browser, which the Nether server serves
([ADR 0053](../../docs/adr/0053-the-web-app-is-the-desktop-page-in-the-browser-signed-in-by-a-cookie.md)).
`VITE_NETHER_TARGET=web` picks its backend, `apps/desktop/src/webBackend.ts`:

- It signs in to the server that serves it, and only that one. The session
  is an `HttpOnly` cookie the page never sees; requests that change
  anything send back the CSRF value of a second cookie.
- Each of the account's workspaces is a vault, kept in the browser's
  origin private file system (`OpfsFiles` in `packages/storage`), with its
  index in SQLite's WebAssembly build in a worker
  (`apps/desktop/src/webIndex.worker.ts`). It syncs with the server as a
  linked desktop vault does, and opens offline once opened.
- A workspace opens in one tab at a time: a second tab on it is told so.
- Invitation links (`/invite#…`), sign-in email links
  (`/sign-in#email=…&code=…`) and single sign-on (back at
  `/sign-in/provider`) come back to it.
- Exports download: Markdown and web pages in a ZIP the page makes, a
  database's CSV, and PDFs through the browser's print dialog. Imports
  come from the browser's file and folder pickers, read as the desktop
  app reads them (`apps/desktop/src/webImports.ts`), ZIP files in the page.

The server serves the build at `/`, with its content security policy
(`apps/server/src/web.ts`). The build adds a web manifest, the icons in
`public/` (`pnpm --filter @nether/web icons` renders them from the desktop
app's `icon.svg`), and a service worker that keeps every file of the
build, so the app installs and opens offline.

## Develop

Start a server on port 3000 (see [its README](../server/README.md)), then:

```sh
pnpm --filter @nether/web dev       # http://localhost:5174, the API sent on to :3000
pnpm --filter @nether/web build     # into dist/, which the server then serves
```

`NETHER_SERVER` points the dev server at another server's address.
