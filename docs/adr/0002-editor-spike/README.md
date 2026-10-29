# Spike: Markdown round trips through editor libraries

Evidence for [ADR 0002](../0002-editor-tiptap.md). Every file in
[`corpus/`](corpus/) goes from Markdown into each library's document and
back to Markdown through the library's own, official Markdown support.
[`run.mjs`](run.mjs) compares each result with its input, and
[`results/`](results/) holds every output and the
[summary](results/summary.md).

## Run it

```sh
cd docs/adr/0002-editor-spike
pnpm install --ignore-workspace
node run.mjs
```

The results here come from a run on 2026-10-30 with Node.js 22.19 on
Windows 11, with the versions pinned in [`package.json`](package.json).

## What went through each library

| Library | Version | Markdown support used |
| --- | --- | --- |
| TipTap | 3.32.1 | `MarkdownManager` from `@tiptap/markdown`, with StarterKit and the official task list, table, image, highlight and math extensions |
| BlockNote | 0.56.0 | `ServerBlockNoteEditor`: `tryParseMarkdownToBlocks`, then `blocksToMarkdownLossy` |
| Lexical | 0.53.0 | `$convertFromMarkdownString` and `$convertToMarkdownString` from `@lexical/markdown`, with `TRANSFORMERS` and `CHECK_LIST`, in a headless editor |
| remark | 11 | `remark-parse` and `remark-stringify` with GFM, frontmatter and math. Not an editor: the syntax tree a converter of our own could build on |

## What the checks mean

| Check | Passes when |
| --- | --- |
| exact | the output is the input, byte for byte, apart from trailing newlines |
| rendering | a CommonMark renderer (markdown-it) gives the same HTML for both, apart from the frontmatter |
| text | every word a reader sees in the input, frontmatter included, is still there |
| links | every link target is unchanged |
| frontmatter | the YAML frontmatter is unchanged |
| obsidian | wiki links, embeds, tags, block IDs, highlights, comments, callouts, math and footnotes are unchanged. CommonMark reads them as plain text, so only this check sees them break |

A check counts only the files it applies to: one file has frontmatter,
three have links, and three have syntax the obsidian check looks for.

## Limits

Eight short files cover the breadth of the syntax, not the size of real
vaults, and nothing here measures speed. Each library ran as shipped,
without the custom tokenizers or nodes that would teach it Obsidian's
syntax: the question was how much each one keeps before we write any.
