# 0024. Unlinked mentions are found by the index and linked where written

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#linking-and-knowledge-graph) ask for
unlinked mentions: "lists notes that mention this title without linking;
one click converts to a link". Obsidian lists them under a note's
backlinks. A vault of 50,000 notes cannot be read whole each time a note
opens, and a link made from a mention must change nothing else in the
file that writes it.

## Decision

- **A mention is a note's name, or one of its aliases, written as text**:
  a whole word, case aside, in text, emphasis, a heading, a list or a
  table. A name in a link, a tag, a path, code, math, a comment, HTML, the
  frontmatter or a block's ID is not a mention. Where names overlap, the
  longest is the one mentioned.
- **The search index finds the notes, and their files show where.** Each
  name is searched as a phrase in the full-text index, which gives at most
  200 notes for it; only those notes' files are read, and
  `findMentions` in `@nether/markdown` reads where in each the names are
  written, with their places in the file.
- **They are found when asked.** The list is closed until the user opens
  it, as reading notes' files costs more than showing a note; once open, it
  is found again for each note shown.
- **A mention is linked where it is written**: only its words are
  replaced, by `[[Roadmap]]` when the mention is written as the link would
  name the note, and by `[[Roadmap|roadmap]]` otherwise, so the sentence
  reads as before. The link names the note by its title, or by its path
  where the title finds another note from there. In a table's cell the
  link's bar is escaped, `\|`. Every other byte of the file stays as it
  was; the file is read again first, and written again if another app
  changed it meanwhile.

## Alternatives

- **Reading every note's text from the index for each note shown.** Simple,
  but it costs the whole vault's text on every switch, against the 100 ms a
  switch may take.
- **Matching in the index alone.** The index folds text and drops the
  syntax, so it cannot tell a name in a link or in code from one in text,
  nor where in the file the name is.
- **Rewriting the mention's block from Nether's model.** The block would be
  written again as Nether writes Markdown, changing its style where the
  user wrote it otherwise.

## Consequences

- A name that is a common word, as `Plan`, finds many notes; the list
  shows at most the notes the index gives for each name.
- Words the index splits differently from the note's name, as `C++`, can
  be missed by the index and so by the list.
- A mention made a link becomes a backlink as soon as the link index reads
  its note again.
