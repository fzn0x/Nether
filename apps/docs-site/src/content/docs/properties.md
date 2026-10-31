---
title: Properties
description: How to give a note properties such as tags, dates and checkboxes, how each type is chosen, and how they are written to the note's frontmatter.
---

A note can have properties: a status, a due date, a list of tags. They show
above the note, each with its name, its type and its value, and they are
stored in the note's file as YAML frontmatter, which Obsidian and other
Markdown tools read too:

```yaml
---
tags: [start, intro]
due: 2026-11-06
done: false
---
```

## Adding and editing properties

Click **Add a property** below the note's properties. The new property's
name is ready to type; press Enter or click away to keep it. Click any name
to rename it, and the × at the end of a row to remove it.

To change the order, drag a property by the handle (⠿) that shows in the
margin before it, and drop it where the line shows. From the keyboard, Tab
to the handle and press the up or down arrow. The note's frontmatter keeps
the order you choose.

How you edit a value depends on its type:

| Type | Edited as |
| --- | --- |
| Text, select, person, file | A line of text |
| Number | A number field |
| Checkbox | A checkbox |
| Date | A date picker; the file gets `2026-11-06` |
| URL | A web address |
| Multi-select, relation | A list: type a value and press Enter or a comma to add it, click its × or press Backspace in an empty field to remove the last one |

In source mode, Ctrl+/, the properties are the frontmatter at the top of
the note, and you edit the YAML yourself.

## How a property gets its type

Choose a type from the menu beside a property's name. The choice holds for
that name in every note of the vault, as in Obsidian, and is kept in the
vault's `.nether/properties.json`. When you change a type, the value is
carried over as near as it goes: `a, b` becomes a list of two, `3` a
number.

A name with no type chosen takes the type its value looks like: `true` is a
checkbox, `2026-11-06` a date, `https://...` a URL, `[[Note]]` a relation,
and a list a multi-select.

## Your frontmatter stays as you wrote it

Nether writes only the properties you changed. The rest of the frontmatter
keeps its order, comments and style: a list written inline, as
`tags: [start]`, stays inline when you add a tag.

When another app changes a note's properties while Nether has it open, the
changes are merged key by key with yours. A frontmatter Nether cannot read,
such as YAML with a syntax error, is never rewritten: the note says why it
cannot show the properties, and you can fix them in source mode.
