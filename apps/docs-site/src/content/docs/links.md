---
title: Linking notes
description: How to link notes with [[, link to a heading, give a note other names, and how Nether finds the note a link names.
---

Type `[[` anywhere in a note, outside code, and Nether lists the vault's
notes as you type their name. Pick one with the arrow keys and Enter, or
click it, and the link goes in. A link shows the note's name; click it, or
select it and press Enter, to open the note.

## Headings and other names

Type `#` after a note's name, as in `[[Roadmap#`, to link to one of its
headings. Without a name, `[[#` lists the headings of the note you are in.

A note can have other names, which links find it by too. Give it an
`aliases` property:

```yaml
---
aliases: [Plan, The plan]
---
```

Then `[[Plan` suggests the note, and the link written is
`[[Roadmap|Plan]]`: it shows Plan, and leads to Roadmap.

## Links to a part of a note

A link to a heading, `[[Roadmap#Next steps]]`, opens the note at that
heading. A link to a block, `[[Roadmap#^b1]]`, opens it at the block whose
file writes `^b1` after it, as Obsidian writes block IDs.

To link to a block, type `#^` after the note's name, as in `[[Roadmap#^`,
then words from the block: Nether lists the note's blocks that have them.
`[[#^` lists the blocks of the note you are in. When the block you pick
has no ID yet, Nether gives it one and writes it after the block in its
note's file, as `^b1`, changing nothing else there.

## Embedding notes

Put `!` before a link, alone on its line, to show the note it names inside
this one: `![[Roadmap]]` shows all of it, `![[Roadmap#Next steps]]` the
heading and what follows it up to the next heading as high or higher, and
`![[Roadmap#^b1]]` the one block. An embed shows the note as it is now, and
follows it as it changes. Click the embed's title to open the note. Embeds
inside an embed show one level deeper; deeper ones show as their links, so
notes that embed each other end. An embed within a line of text shows as
you wrote it, and still links: the note it names lists this one among its
backlinks, as in Obsidian.

## Synced blocks

A block of another note embedded by its ID, as `![[Roadmap#^b1]]`, is a
synced block: edit it where it is embedded, and Nether writes the edit to
the block in its note, so every note that embeds it shows the edit. The
block lives in its note alone, and the notes that embed it hold only the
link, so Obsidian shows the same block in each of them. A synced block has
a dashed line beside it.

- Its edits are written half a second after you stop typing, and when you
  leave the block. Everything else in its note's file stays as it was.
- It holds one block. Enter in the block's own line breaks the line; to
  sync several blocks, give a callout, a quote or a list item an ID, and
  embed it with everything inside it.
- While you edit a synced block, it keeps your text; once you leave it, it
  shows what another note or another app has changed since.
- An embed of a heading's section, of a whole note, or of a block of the
  note it is in, is read only: open the note to edit it there.

To make one, link to a block as above, then put `!` before the link.

## Outline, backlinks and tags

Beside each note, Nether shows its outline, the note's headings, which go
to the heading when clicked, and the notes that link to it, each with the
text around its links. On a narrow window they show below the note.

Below them, **Unlinked mentions** opens the list of the notes that write
the note's name, or one of its aliases, without linking it: each mention on
its line, with the name marked. **Link** makes that mention a link,
`[[Roadmap]]`, or `[[Roadmap|roadmap]]` where it is written otherwise, so
the sentence reads as before, and changes nothing else in the file. A name
counts as a whole word, case aside, but not inside a link, a tag, a path,
code, math, a comment or HTML. The list stays open from note to note until
you close it.

The **Tags** list in the sidebar shows every tag in the vault, from `#tag`
in notes and from their `tags` property, with nested tags such as
`#area/project` under theirs and how many notes have each. Click a tag,
there or in a note, to list the notes with it, nested tags included.

## Links typed in full

A link typed in full, such as `[[Next steps]]`, becomes a link when you
type its last bracket. If the vault has no note by that name yet, opening
the link makes one, at the top of the vault, or in the folder its name
gives, as in `[[Projects/Next steps]]`.

## Renaming a note

Click a note's name above it, change it, and press Enter; Escape keeps the
old name. Every link to the note follows: Nether rewrites the links that
named it, in the text and the properties of every note, so they find it
under its new name.

- A wiki link names the note by its new name, or by its path when another
  note has that name or the link was written with a path, and keeps its
  heading, block and alias: `[[Plan#Goals|goals]]` becomes
  `[[Roadmap#Goals|goals]]`.
- A Markdown link, `[the plan](Plan.md)`, leads to the note's new path from
  where it is written.
- Links in code stay as they are, since they are text.

A name cannot have `\ / : * ? " < > | # ^ [ ]` in it, or start with a dot,
so that every system can hold the file and every link can name it.

## How a link finds its note

Nether finds the note a link names as Obsidian does, so links work the
same in both apps: by its name, or its path, from the note the link is in,
then from the vault's folder, then any note whose path ends with the link,
the nearest first. Letter case does not matter. When two notes share a
name, Nether writes the shorter path that tells them apart, as
`[[Archive/Roadmap]]`.

When you open a vault, Nether reads the links of every note in the
background, and then each note again whenever it changes. A large vault's
first reading shows its progress below the list of notes; later ones read
only the notes that changed.
