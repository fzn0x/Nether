---
title: Templates and daily notes
description: How to start a note from a template, what a template's variables fill in, and how today's, this week's and this month's notes are made.
---

A template is a note that new notes start from. Any note can be one: those
in the vault's `Templates` folder are listed first, and you can find any
other by typing.

## Making a note from a template

Press Ctrl+N (Cmd+N on a Mac), or click **New note**. Type the note's name,
with folders before it as in `Projects/Kickoff`, or leave it empty for
`Untitled`. Under **Start from**, choose a blank note or a template, or type
to find another note, and press Enter.

The new note gets the template's text, frontmatter included, with its
variables filled in, and opens with the cursor where the template says.

## Variables

| You write | You get |
| --- | --- |
| `{{title}}` | The new note's name |
| `{{date}}` | Its date, as `2026-11-06` unless the vault's date format says otherwise |
| `{{time}}` | The time it was made, as `14:30` unless the vault's time format says otherwise |
| `{{date:dddd, MMMM Do}}` | The date in that format: `Friday, November 6th` |
| `{{date-1d}}`, `{{date+1w:YYYY-[W]WW}}` | The date moved by days (`d`), weeks (`w`), months (`M`) or years (`y`) |
| `{{yesterday}}`, `{{tomorrow}}` | The days before and after |
| `{{cursor}}` | Where the cursor goes when the note opens |

These are the variables Obsidian's templates and the Periodic Notes plugin
fill, so templates you already have work as they are; `{{cursor}}` is
Nether's own. For a daily, weekly or monthly note, `{{date}}` is the day the
note is for, and a week's is its Monday.

Formats use [moment.js tokens](https://momentjs.com/docs/#/displaying/format/),
as Obsidian does: `YYYY` the year, `MM` the month, `DD` the day, `dddd` the
day's name, `HH:mm` the time, `WW` the week of the year by ISO 8601. Text in
square brackets is written as it is.

## Daily, weekly and monthly notes

Click **Today** to open today's note. The first time, Nether makes it from
the daily note template; after that, the button opens the same note. Weekly
and monthly notes work the same way, with **This week** and **This month**,
once you turn them on in the settings. A week starts on Monday.

## Settings

Click **Settings** at the top of the sidebar to choose:

- the folder your templates are in, and how `{{date}}` and `{{time}}` are
  written;
- for daily, weekly and monthly notes, whether their button shows, the
  folder they go in, how they are named, and the template they start from.

A name format can make folders: `YYYY/MM/YYYY-MM-DD` puts each day's note in
a folder for its year and month. Each format shows what it writes for now as
you type.

Nether keeps these settings in the vault, in `.nether/templates.json`. A
vault moved from Obsidian starts from Obsidian's own settings for its
templates, daily notes and the Periodic Notes plugin, so today's note goes
where Obsidian put it. Nether reads those settings and never changes them.
