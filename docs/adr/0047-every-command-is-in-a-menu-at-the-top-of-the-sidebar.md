# 0047. Every command is in a menu at the top of the sidebar

- Status: Accepted
- Date: 2026-11-01

## Context

The maintainer opened the desktop app and found no way to the features of
Phase 2: the graph, new databases, import, themes and snippets, nor to the
servers and sync of Phase 3. Each was a command, run from the command
palette (Ctrl+P) or its shortcut, and nothing on screen said so. The
sidebar showed New note, the periodic notes, and a Settings button that
opened only the settings for templates.

The [requirements](../requirements.md#editor-and-writing) ask that every
action have a shortcut and that the app be keyboard-first; the
[non-functional requirements](../requirements.md#non-functional-requirements)
ask for full keyboard navigation and labels on every control.

## Decision

**A menu bar at the top of the sidebar**, under the vault's name: File,
Note, View, Sync and Settings. Its items are the palette's commands
(`commands.ts`), grouped, each named as in the palette and showing the
shortcut the vault gives it, so a command added to the palette is placed
in a menu in the same change. Every command the palette has is in one.

**A command that cannot run now shows, greyed out**, as those about a note
while none is open: the menus show what the app can do, and the palette
still lists only what can run.

**The keyboard follows the menu bar pattern of WAI-ARIA**: one tab stop;
Left and Right move between the menus; Down, Enter or Space opens one; in
an open menu Left and Right open the menu beside it, mirrored right to
left. The menus are the note's menu (ADR 0046's `ContextMenu`), which
gains shortcuts, greyed items and the move to a neighbour.

**New database** sits beside New note, as the one structure of Phase 2 a
vault starts from. The Settings button gives way to the Settings menu.

## Alternatives

- **The system's menus**, a menu bar in the window's frame on Windows and
  Linux and at the top of the screen on a Mac. Where desktop apps keep
  them, but MyGO would need to build each menu natively on three systems,
  and they would not follow the vault's shortcuts or its themes. Left for
  when MyGO has them.
- **A ribbon of icons**, as Obsidian's: compact, but an icon names little
  without hovering, and a ribbon for every command would be long.
- **Only a hint about Ctrl+P**: no new control, but the features stay
  hidden until read about.

## Consequences

- A new command needs a place in a menu as well as a name.
- The settings for templates are a menu item away, not a button.
