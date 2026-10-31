---
title: Commands and shortcuts
description: How to run any action from the command palette, the keyboard shortcuts Nether starts with, and how to change them.
---

Everything Nether does can be done from the keyboard. On a Mac, read Cmd
for Ctrl in the shortcuts below.

## The command palette

Press **Ctrl+P** to open the command palette. Type part of a command's
name, move to it with the arrow keys, and press Enter to run it; each
command shows its shortcut beside it. Commands about a note, such as
renaming it, show once a note is open.

## Shortcuts

| Command | Shortcut |
| --- | --- |
| Open the command palette | Ctrl+P |
| Open a note by its name | Ctrl+O |
| Search the vault | Ctrl+Shift+F |
| New note | Ctrl+N |
| Open today's note | Ctrl+Shift+D |
| Show the note as Markdown or as blocks | Ctrl+/ |
| Rename the note | F2 |
| Export… | Ctrl+Shift+E |
| Open the graph | Ctrl+G |
| Templates and periodic notes settings | Ctrl+, |

The other commands, such as opening this week's note, moving the note to
the trash or showing the tags, have no shortcut until you give them one.

In the editor, blocks have their own keys: Ctrl+D duplicates the block the
caret is in, and Ctrl+Shift+↑ and Ctrl+Shift+↓ move it.

## Changing a shortcut

Run **Keyboard shortcuts** from the command palette. Each command is
listed with its shortcut:

- Click **Change**, then press the keys you want. Escape stops listening;
  Backspace leaves the command with no shortcut.
- A shortcut needs Ctrl, Alt or Cmd, or is a function key such as F2, so
  that typing never runs a command.
- Keys another command had move to this one, and Nether says which
  command lost them.
- **Reset** gives a command its shortcut back.

Click **Save** to keep the changes. Nether keeps them in the vault, in
`.nether/hotkeys.json`, so each vault can have its own.
