# 0030. Web pages import through the syntax-tree project's HTML tools

- Status: Accepted
- Date: 2026-10-31

## Context

The requirements ask for an import from HTML: a saved article, a page
exported from another app. A web page holds more than its text: its head,
styles, scripts and markup only a browser reads. Nether reads and writes
Markdown with the syntax-tree project's tools, mdast and micromark
([ADR 0006](0006-markdown-file-format.md)); the same project reads HTML
into hast, its tree for HTML, and turns hast into mdast. Every dependency
must have a license compatible with AGPL-3.0, and the desktop app must
still open in under 1.5 s.

## Decision

- **A page is read by `hast-util-from-html`**, which parses as browsers do
  (parse5), and **turned into Markdown by `hast-util-to-mdast`**, written by
  the same `mdast-util-to-markdown` Nether writes notes with: headings,
  paragraphs, lists, quotes, tables, links, images, code and emphasis.
  Both are MIT, from the project whose tools Nether already uses.
- **What a reader does not see stays behind**: the page's head, styles and
  scripts.
- **Each page is a note named by its title**, its `<title>`, else its first
  heading, else its file's name, in a folder named `Imported`; a title a
  file's name cannot hold is kept as the note's alias, and two pages of the
  same title become `Title` and `Title 2`.
- **The importer is an entry of its own**, `@nether/markdown/html-import`,
  which the app loads only to import web pages: the parser is 223 kB,
  70 kB compressed, and none of it is in what the app loads to open.

## Alternatives

- **Turndown**, the best-known HTML to Markdown converter. MIT and small,
  but it reads HTML through the browser's DOM, which a server or a test
  does not have, and writes Markdown its own way rather than as Nether
  writes it.
- **Keeping a page as HTML in a note.** Obsidian shows some HTML, but a
  note of markup is not one people can edit as text.

## Consequences

- Images and links keep their addresses as the page wrote them; a page's
  images are not downloaded.
- Markup Markdown has no form for, as a coloured span, keeps its text and
  loses its look.
