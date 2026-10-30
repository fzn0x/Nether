# 0012. Export notes from the page's own HTML, and let the app write the files

- Status: Accepted
- Date: 2026-10-30

## Context

The [requirements](../requirements.md) ask to export a note, a folder or a
workspace as Markdown in a ZIP, as HTML and as PDF; databases to CSV come
with databases in Phase 2. An export must keep what a note shows: links
between notes, images and files, callouts, tables, math, highlighted code,
Mermaid diagrams and embedded notes.

The page already draws all of these in the editor, with KaTeX, lowlight and
Mermaid. The desktop app's Go side can write files anywhere the user
chooses, and MyGO prints a page to PDF through the system's webview.
Vaults can hold 50,000 notes, so an export cannot be one message between
the page and the app.

## Decision

- **One HTML renderer in `@nether/markdown`.** It writes a note's blocks as
  the elements a browser shows them as, with no dependency. What only the
  app can draw comes from hooks:
  - where links and files lead;
  - math, as MathML from KaTeX, which browsers draw without KaTeX's fonts
    and styles;
  - code highlighted with the editor's lowlight;
  - Mermaid diagrams as SVG;
  - embedded notes, two deep, as in the editor.
  `%%comments%%` are left out. Only web, mail and phone addresses, and paths
  within the export, become links.
- **Markdown exports are the notes' files as they are**, with the files
  they show, or with every file of the vault when the whole vault goes. The
  files are never rewritten.
- **HTML exports are a page per note**, at the note's path with `.html`. A
  link to a note in the export leads to its page and heading; a link to
  one outside it stays text. The files a note shows go beside the pages, and
  an index lists the pages. The pages follow the reader's light or dark
  preference.
- **PDFs are the page printed.** Each note's article goes into a print view
  in the app's page, shown only in print with the app hidden. MyGO's
  `PrintToPDF` prints it, light, each note on a new page, on A4 or Letter,
  and the print view is removed.
- **The app writes the files.** The Go side asks where to save before any
  work starts. A ZIP is written from batches the page sends, as the page's
  text or files copied by the app from the vault, beside its destination
  until it is whole. Its paths cannot leave the folder it is unpacked in.
  The app shows in the file manager only files an export saved.

## Alternatives

- **remark and rehype from the Markdown files.** They would need plugins
  for every Obsidian syntax Nether already reads into blocks, and would
  read each note a second way.
- **A ZIP library in the page**, such as fflate. It would work on the web
  too, but the whole archive would pass from the page to the app; Go's
  `archive/zip` streams files from disk. The web app will export through
  the server in Phase 3.
- **A PDF library**, such as pdf-lib or a headless browser. pdf-lib draws
  no HTML; a headless browser is a large download. The webview already
  lays out what the app shows.
- **KaTeX's HTML output.** It needs KaTeX's style sheet and fonts beside
  every export; MathML needs nothing and prints as text.

## Consequences

- An export looks like the app, and new block types need a case in one
  renderer, which its tests cover.
- A PDF is only as good as the webview's print, which differs a little
  between WebView2, WebKit and WebKitGTK.
- The browser preview keeps its exports in memory for the end-to-end tests;
  the web app needs its own way to save, with the server, in Phase 3.
- Exporting a large vault as HTML or PDF reads and draws every note: the
  dialog shows how far it has come and can be cancelled.
