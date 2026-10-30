# 0011. Fill templates with Obsidian's variables, and start from Obsidian's settings

- Status: Accepted
- Date: 2026-10-30

## Context

The [requirements](../requirements.md) ask that any note can be a template,
with variables for the date, the title and the cursor and a template
picker for new notes, and that one click makes today's, this week's or
this month's note from a template.

Most people who come to Nether from Obsidian already have templates and
daily notes. Obsidian's Templates plugin fills `{{title}}`, `{{date}}` and
`{{time}}`, with a moment.js format after a colon. Its Daily notes plugin,
and the community Periodic Notes plugin for weeks and months, name notes by
moment.js formats such as `YYYY-MM-DD` and `gggg-[W]ww`, and keep their
settings as JSON in the vault's `.obsidian` folder. Obsidian's own
templates have no cursor variable.

A template's cursor may stand alone on its line, as in a heading followed
by `{{cursor}}`. A Markdown file has no way to keep an empty paragraph
there, so the cursor cannot be found again by reading the file.

## Decision

- **Obsidian's variables.** A template is any note; its text is filled
  with `{{title}}`, `{{date}}` and `{{time}}`, each with an optional
  moment.js format after a colon, as Obsidian fills them. From the
  Periodic Notes plugin, `{{date+1d}}`-style offsets in days, weeks,
  months and years, and `{{yesterday}}` and `{{tomorrow}}`. Names are read
  case aside; anything else in double braces stays as it is.
- **`{{cursor}}`, Nether's own.** The first one is where the cursor goes;
  any other is dropped. While the template is read it is a private use
  character, and the note's Yjs document, which holds the empty block a
  lone cursor needs, is written with the file before the note opens. A
  template whose text has that character already places no cursor.
- **moment.js formats without moment.js.** `@nether/core` writes the
  tokens Obsidian users write, ISO weeks (`W`, `GGGG`) and Sunday-first
  weeks (`w`, `gggg`) as moment's English locale counts them, and month
  and day names through `Intl`, in about two hundred lines.
- **Weeks start on Monday.** This week's note is the ISO week's, named by
  its Monday, whatever its name format.
- **Settings in `.nether/templates.json`.** The templates folder, the date
  and time formats, and for each period whether it is offered, its folder,
  name format and template. A vault without that file starts from
  Obsidian's `templates.json`, `daily-notes.json` and
  `plugins/periodic-notes/data.json`, which Nether reads and never writes.
  Saving writes Nether's file, which is then the one read.
- **Templates are listed from a folder, `Templates` unless set**, and the
  picker finds any other note by its path, so a note need not move to be
  used as one.

## Alternatives

- **Templater's syntax** (`<% tp.date.now() %>`) runs JavaScript in the
  vault, which the plugin sandbox of Phase 4 is for; its simple tags may
  be added then as a plugin.
- **moment.js, or Day.js with its plugins.** Both are MIT and well known,
  but moment is in maintenance mode and about 60 KB minified, and Day.js needs
  several plugins for weeks and ordinals; the subset templates use is
  small and fully tested here.
- **Finding the cursor by searching the opened note's text** for what
  stood around the marker fails on a lone cursor, whose line the file
  drops, and on text the template repeats.
- **Writing Obsidian's settings when Nether's change** would let both apps
  share them, but could break a vault's Obsidian setup with values
  Obsidian does not read, such as the week's template in the daily notes
  file.
- **A week start that follows the locale** would match moment in Obsidian
  for Sunday-first countries, but makes the same vault name different
  notes on different computers.

## Consequences

- A vault moved from Obsidian opens today's note where Obsidian puts it,
  from the same template, with no setup.
- Once settings are saved in Nether, later changes in Obsidian's settings
  do not reach Nether.
- The formatter must grow with the tokens people use; one it does not know
  is written as it is, as moment writes unknown letters.
- Month and day names follow the language given; the app passes English
  until the interface is translated.
