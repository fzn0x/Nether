# @nether/markdown

Markdown files to and from Nether's notes. It reads CommonMark, GFM, YAML
frontmatter and Obsidian's syntax into the blocks and inlines of
[`@nether/core`](../core/), and writes notes back so that every block that
did not change keeps its exact bytes. The format is recorded in
[ADR 0006](../../docs/adr/0006-markdown-file-format.md).

```ts
import { parseMarkdown, serializeMarkdown } from "@nether/markdown";

const parsed = parseMarkdown(fileText);
// parsed.properties: the frontmatter; parsed.content: the blocks, each with an ID.

const { text, source } = serializeMarkdown(
  { properties: parsed.properties, content: editedBlocks },
  { source: parsed.source, writeIds: linkedBlockIds },
);
// text: the new file, with unchanged blocks byte for byte.
// source: what to pass to the next serializeMarkdown of this note.
```

## How it is built

| File | What it does |
| --- | --- |
| `src/syntax.ts` | micromark extensions for wiki links, embeds, tags, highlights, comments and math, as Obsidian reads them |
| `src/tree.ts` | Markdown to an mdast syntax tree with positions |
| `src/frontmatter.ts` | YAML frontmatter to properties and back, keeping comments and order |
| `src/parse.ts` | The syntax tree to blocks, block IDs from `^id`, and a source map of the top-level blocks |
| `src/to-markdown.ts` | Blocks to an mdast tree and Markdown, with handlers for Obsidian's syntax and Nether's blocks |
| `src/serialize.ts` | A note back to Markdown, keeping the bytes and spacing of what did not change |

## Tests

`pnpm test` runs, with coverage:

- the syntax of each Obsidian construct, and what it must leave as text;
- what each kind of Markdown becomes, block IDs included;
- edits that must leave the rest of a file byte for byte;
- a round trip of every file in [`test/corpus`](test/corpus/);
- property tests that write and read back hundreds of random notes made
  of every block and inline type. `PROPERTY_RUNS=5000 pnpm test` runs more,
  and a failure prints the seed to replay it with `PROPERTY_SEED` and
  `PROPERTY_PATH`.
