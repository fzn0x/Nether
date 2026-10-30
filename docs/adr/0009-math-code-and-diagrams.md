# 0009. Render math with KaTeX, code with lowlight, and diagrams with Mermaid without ELK

- Status: Accepted
- Date: 2026-10-30

## Context

The rich blocks of the requirements include LaTeX math, code blocks with
syntax highlighting and Mermaid diagrams. Each needs a renderer in the
page, and each renderer is a dependency whose license
[ADR 0001](0001-license-agpl-and-dco.md) must allow.

Mermaid 12 depends on elkjs, the Eclipse Layout Kernel, for its ELK layout,
and makes that layout its default. elkjs is under the EPL-2.0 and does not
name the GPL as a secondary license, so it cannot be combined with
AGPL-3.0 code in the app Nether ships. The license scan fails on it.

## Decision

- **Math:** KaTeX, MIT, renders inline and display math. `trust` stays off,
  so `\href`, `\url` and `\htmlClass` cannot add links, classes or scripts.
- **Code:** lowlight, MIT, with highlight.js's 37 common grammars,
  BSD-3-Clause, highlights code in a language it knows. Code without a
  language, or in one it does not know, stays plain: guessing would run
  every grammar over every such block on each change, and often guess wrong.
- **Diagrams:** Mermaid, MIT, draws a code block in the `mermaid` language
  below its code, with `securityLevel: "strict"`, which sanitizes the SVG and
  turns off clicks and scripts in diagrams.
- **Without ELK:** a pnpm override replaces elkjs with a stand-in in
  `tools/stubs/elkjs`, under Nether's license, so the EPL-2.0 code is never
  installed or shipped. Nether starts Mermaid with the dagre layout, MIT, as
  its default. A diagram that asks for ELK, with `layout: elk` or as
  `flowchart-elk`, shows an error that says ELK is not included.
- **Loading:** KaTeX and Mermaid load with the first note that shows math or
  a diagram, so the editor's own code does not grow by their size. Until
  KaTeX arrives, math shows as its LaTeX.

## Alternatives

- **Mermaid 11,** whose ELK layout is a separate package. It would leave
  Nether on an old major version, without the fixes that come after.
- **No Mermaid,** with diagrams shown as code. Diagrams are a requirement,
  and Obsidian users have them in their notes.
- **Shiki or Prism for code.** Shiki highlights with TextMate grammars and is
  more exact, but it is larger and loads its grammars asynchronously, which
  the editor's highlighting, done on each change, does not suit. Prism is no
  longer developed actively.
- **MathJax for math.** It renders more of LaTeX but is several times
  larger and slower to render than KaTeX, which covers what notes use.

## Consequences

- Diagrams that relied on ELK's layout are drawn by dagre, or, when they ask
  for ELK by name, show an error. A plugin may later let a user install ELK
  for their own use, which the AGPL does not restrict.
- When Mermaid updates, the override keeps elkjs out, and the license scan
  catches any other dependency it adds.
- KaTeX's fonts ship with the app in the three formats its styles name,
  1.2 MB in all; the page loads only the WOFF2 fonts the math on screen
  uses, at most 292 kB.
