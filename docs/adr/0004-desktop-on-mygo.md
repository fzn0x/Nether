# 0004. Build the desktop app on MyGO, with the shared UI in a web page

- Status: Accepted
- Date: 2026-10-30

## Context

The desktop app is where Nether's local-first promise lives: it works with
no account and no server, keeps the vault as Markdown files in a folder the
user picks, and must meet the hardest targets in the
[requirements](../requirements.md#non-functional-requirements): open to the
last note in under 1.5 s cold, open any note in under 100 ms, type with
under 16 ms of latency, and idle under 300 MB with a 50,000-note vault. It
ships for Windows, macOS and Linux, with auto-updates that can be turned
off.

The desktop app is built with [MyGO](https://github.com/egoist/mygo), as
our earlier desktop app MixMusic is. MyGO writes desktop apps in Go, with
no cgo, and each window shows either a web page in the system's webview
(WebView2, WKWebView or WebKitGTK) or native UI that MyGO draws on the
GPU. Pages call Go through bound services, with a TypeScript client that
`mygo generate` writes. MyGO is MIT licensed. Its SQLite plugin ships
SQLite with FTS5 and needs no C compiler, and `mygo.WatchFiles` watches
folders.

What remained open: does the editor run in native views or in a web page,
and how does the desktop share `packages/core` and the other TypeScript
packages with the web and mobile apps? The editor is TipTap on ProseMirror
with Yjs ([ADR 0002](0002-editor-tiptap.md),
[ADR 0003](0003-sync-yjs-hocuspocus.md)), which needs a browser engine.

To size the two kinds of window, a probe app on MyGO 0.6.2 opened one
1100 by 720 window three times each way on the maintainer's Windows 11
machine, idled 8 seconds, and summed the memory of its process tree:

| Window | Launch to content | Idle private working set | Processes |
| --- | --- | --- | --- |
| Web page (WebView2), a blank page | 687 ms on the first run, 282 to 292 ms after | 68 to 72 MB | 7 |
| Native UI, two lines of text | 72 to 84 ms (first view built) | 15 MB | 1 |

The private working set is what the Task Manager shows as memory. Counted
as working sets, which include memory shared with other programs, the web
page took 288 to 301 MB and the native window 47 to 51 MB.

## Decision

1. **`apps/desktop` is a MyGO app**: a Go module on the same MyGO line as
   MixMusic (0.6.2), with the `mygo` command pinned as a Go tool
   (`go tool mygo`) and the app described in `mygo.json`.
2. **Its main window shows a web page**: the Nether UI in React, from
   `packages/ui` and `packages/editor`, built by Vite and embedded in the
   executable by `mygo build`. The TypeScript packages (`core`,
   `markdown`, `search`, `graph` and the rest) run in that page, the same
   code the web and mobile apps run.
3. **Go keeps to what only the desktop can do**: reading and writing the
   vault folder with atomic writes, watching it, the SQLite database with
   FTS5 through MyGO's SQLite plugin, and the operating system: menus, the
   tray, a global shortcut, `nether://` links, `.md` file associations and
   updates. The page reaches Go only through bound services and the
   generated client, which is committed and checked in CI.
4. **`packages/storage` defines the storage interface** that each client
   implements: the desktop through those services, the web app with
   IndexedDB, the mobile apps with SQLite through Capacitor.
5. **Native UI is for small windows that must open at once and need no
   editor**, such as quick capture from the global shortcut.
6. **The watcher covers the whole vault.** `mygo.WatchFiles` keeps a
   snapshot of at most `MaxEntries` files and folders, 8,192 by default on
   Windows and Linux and 65,536 on macOS; Nether raises it above the
   vault's size. Where a system cannot watch that many, Nether falls back
   to hints-only watching and rescans the folders the hints name.

## Alternatives

- **Native UI for the whole app**, as MixMusic moved to. In the probe it
  opened about 200 ms sooner once warm and idled about 55 MB lower, but
  the editor needs a browser engine, the UI would be written twice (Go
  here, React for web and mobile), and plugins that add views or panels
  would need a second API.
- **A native shell with a web view for the editor only.** Any window
  that shows the editor pays the webview's cost, about 53 MB more than
  the native window above, so drawing the sidebar and panels natively
  saves little, and it still splits the UI across two toolkits.
- **Electron.** It bundles its own copy of Chromium in every app, which
  makes downloads far larger than with the system webview, and adds a
  second desktop stack beside the one we use.
- **Tauri.** The same system-webview model in Rust; MyGO gives us that
  model in Go, with the SQLite and watch plugins Nether needs.

## Consequences

- Both the startup and the memory targets leave room above the probe's
  numbers: about 0.3 s to the first page when warm, 0.7 s on a first
  run, and 68 MB of 300 MB. Phase 1 must keep it so at 50,000 notes, by
  keeping the index in SQLite rather than in the page's memory and by
  indexing in a worker. Its gate measures this, on Windows, macOS and
  Linux.
- Linux needs WebKitGTK 4.1 (or 4.0) and Windows 10 the WebView2 Runtime,
  which Windows 11 includes; macOS needs nothing. The Debian package
  depends on WebKitGTK.
- MyGO needs no cgo, so Ubuntu runners build the Windows and Linux apps,
  and CI builds all three platforms on every push. Signing and
  notarizing macOS apps needs a macOS runner, at release time.
- The webviews differ: WebView2 is Chromium, WKWebView and WebKitGTK are
  WebKit. End-to-end tests run the UI in Chromium with Playwright; the Go
  side has Go tests; each release is tried by hand on all three systems.
- MyGO is young and releases often. Its version is pinned exactly and
  upgraded on purpose, with the tests, as MixMusic does.
- We would revisit this if the Phase 1 gate could not meet the startup or
  memory targets with the editor in a web page.
