# @nether/desktop

The desktop app for Windows, macOS and Linux, built with
[MyGO](https://github.com/egoist/mygo). It keeps the vault as Markdown files
in a folder the user chooses, and works with no account and no server.

Its window shows the Nether UI as a web page, built by Vite from `src/`,
and the page calls the Go services in `main.go` through the client that
`mygo generate` writes to `src/mygo.ts`. Go keeps to what only the desktop
can do: the vault folder, the file watcher, SQLite and the operating
system. See [ADR 0004](../../docs/adr/0004-desktop-on-mygo.md).

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

## Packages

`go tool mygo build` writes, for each platform in `build/`:

| Platform | Packages |
| --- | --- |
| Windows | the app and its installer, `Nether Setup <version> amd64.exe` |
| macOS | the app, universal for Intel and Apple silicon, and its disk image |
| Linux | the app, its Debian package, and an archive with `install.sh`, which installs it for the user and lets it update itself |

On Linux, two more packages are made from the Linux build's own files,
as CI does for every change:

```sh
sh packaging/appimage.sh build/linux-amd64 path/to/appimagetool   # Nether-<version>-x86_64.AppImage
flatpak-builder --user --install out packaging/flatpak/io.github.fzn0x.Nether.yml
```

Both use the system's, or the Flatpak runtime's, GTK and WebKitGTK.

## Updates

The app updates itself through MyGO's updater once it is built with an
update key; until then, it checks for nothing and the command palette
offers no update commands. A maintainer sets it up once:

1. `go tool mygo keygen` writes the key pair; keep the secret key in a
   password manager and in the repository's CI secrets as
   `MYGO_UPDATER_PRIVATE_KEY`.
2. Add `"updates": { "publicKey": "…", "github": "fzn0x/Nether" }` to
   `mygo.json`.
3. Release with `MYGO_UPDATER_PRIVATE_KEY` set, which signs each
   platform's build and writes its update manifest.

The app checks in the background, and the command palette turns the
checks off or on and checks now. Apps a package manager installed, from
the Debian package or the Flatpak, are updated by it instead.

## The icon

`resources/icon.png` is rendered from `icon.svg` by
`pnpm --filter @nether/desktop icon`.
