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

## Links typed in full

A link typed in full, such as `[[Next steps]]`, becomes a link when you
type its last bracket. If the vault has no note by that name yet, opening
the link makes one, at the top of the vault, or in the folder its name
gives, as in `[[Projects/Next steps]]`.

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
