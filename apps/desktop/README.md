# @nether/desktop

The desktop app for Windows, macOS and Linux, built with
[MyGO](https://github.com/egoist/mygo). It keeps the vault as Markdown files
in a folder the user chooses, and works with no account and no server.

Its window shows the Nether UI as a web page, built by Vite from `src/`,
and the page calls the Go services in `main.go` through the client that
`mygo generate` writes to `src/mygo.ts`. Go keeps to what only the desktop
can do: the vault folder, the file watcher, SQLite and the operating
system. See [ADR 0004](../../docs/adr/0004-desktop-on-mygo.md).

So far the window shows the app's name, version and platform; the vault
and the editor arrive in Phase 1.

## Develop

You need Go 1.27, Node.js and pnpm. MyGO uses no cgo, so there is no C
compiler to install. To run the app, Linux needs GTK 3 and WebKitGTK 4.1
(`sudo apt install libwebkit2gtk-4.1-0` on Debian and Ubuntu), and
Windows 10 the WebView2 Runtime, which Windows 11 includes.

```sh
pnpm --filter @nether/desktop dev         # go tool mygo dev: the app, reloading as you edit
pnpm --filter @nether/desktop build:app   # go tool mygo build: the app and its installer in build/
```

`go tool mygo` runs the MyGO command at the version `go.mod` pins.

## Tests

```sh
go test ./...                             # the Go side
pnpm --filter @nether/desktop typecheck
pnpm --filter @nether/desktop test:e2e    # the page in Chromium, with Playwright
```

After changing a bound Go service, run `pnpm --filter @nether/desktop
generate` and commit the new `src/mygo.ts`; CI fails when it is out of
date.

## The icon

`resources/icon.png` is rendered from `icon.svg` by
`pnpm --filter @nether/desktop icon`.
