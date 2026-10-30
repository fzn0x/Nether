# 0010. Serve a vault's media to the page from a loopback server, and find files as Obsidian does

- Status: Accepted
- Date: 2026-10-30

## Context

Notes embed images, PDFs, audio and video from their vault, written
`![[photo.png]]` or `![](attachments/photo.png)`. The desktop app's page
cannot read the vault's files itself: it needs URLs to load them from, and
people expect the same links to find the same files as in Obsidian.

MyGO serves custom URL schemes from Go, but WebKitGTK, the webview on Linux,
does not play audio or video from a custom scheme. Its documentation
suggests a server on the loopback interface for media, on every platform.
Every program on the machine can reach such a server, and a web page in a
browser can send it requests.

## Decision

- **A loopback server for media.** The Go side starts an HTTP server on
  `127.0.0.1`, on a free port, the first time the page asks for a vault's
  media URL. It answers only:
  - under a 256-bit random secret in the path, which only the page learns;
  - for vaults the app has open, and only inside them: no `..`, no hidden
    files or folders such as `.nether`, no links that lead out;
  - with images, PDFs, audio and video, by extension, served with their type
    and `nosniff`, SVGs with a sandboxing content security policy;
  - to `GET` and `HEAD`, with ranges so media can seek, and only when the
    `Host` header names the server itself, which turns away pages that
    rename their own site to the loopback address.
- **Links as Obsidian reads them.** A link names the file at that path from
  the note's folder, then from the vault's own folder, then any file whose
  path ends with the link, the nearest to the note first; case does not
  matter. A link that starts with `/` names a path from the vault's folder
  only. New links are the shortest that find their file: its name alone
  when no nearer file has that name.
- **Attachments.** Files pasted or dropped into a note go in an
  `attachments` folder at the vault's top, are never written over another
  file (the second `a.png` becomes `a 1.png`), and are embedded as
  `![[name]]`. Pasted images are named `Pasted image` and the time, as
  Obsidian names them.
- **Opening files.** The app opens a PDF, image, audio or video file in the
  system's app for it on request, and shows any other file in the file
  manager rather than open it, since a note could name a program.

## Alternatives

- **A custom scheme for images and PDFs, the server for media only.** Two
  ways to load files where one does for all.
- **Data URLs or blobs made by the page from bytes Go sends.** Every file
  would cross the bridge as base64 and stay in memory; video could not
  stream or seek.
- **Files next to the note, or in the vault's top folder,** for
  attachments. Obsidian offers both. A folder of its own keeps notes
  readable in a file manager; a setting can offer the others later.

## Consequences

- The server's port is open on the loopback interface while the app runs.
  Without the secret it answers nothing; with it, only the media of open
  vaults.
- The same links find the same files in Nether and Obsidian, and the
  links Nether writes are the ones Obsidian writes by default.
- WebKitGTK has no PDF viewer: on Linux a PDF shows as a card that opens it
  in the system's app, until Nether renders PDFs itself for PDF annotation.
