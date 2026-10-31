# 0046. Notes open in tabs, in at most two panes, each with its own

- Status: Accepted
- Date: 2026-10-31

## Context

The desktop app showed one note at a time: the note chosen in the sidebar,
in the main pane. The maintainer asked for a note's menu to open a note in
a new tab and to the right, as Obsidian and browsers do, and chose how far
that goes: tabs, in at most two panes side by side, remembered for the
vault on the device, with Ctrl+Tab and Ctrl+W. Obsidian's splits in any
number and either direction, with tabs dragged between them, were weighed
and left for later.

The [requirements](../requirements.md#editor-and-writing) ask that every
action have a shortcut, and the
[non-functional requirements](../requirements.md#non-functional-requirements)
that a note open in under 100 ms and the app open to the last note in
under 1.5 s.

Much of the app acted on "the open note": the commands about a note, the
dialogs for its export and history, and the requests the main pane's
editor answers, to switch to Markdown source, take a new name, comment on
the selection, or show a thread a notification opened. Whether a note
shows as blocks or as source was one choice for the app.

## Decision

**A layout of panes and tabs** (`apps/desktop/src/tabs.ts`): one pane, or
two side by side; each pane has its notes' tabs and the one it shows; one
pane is focused. Every change is a function from layout to layout, tested
on its own:

- **Open** shows the note in the focused pane's tab, in place of the note
  it showed. **Open in new tab** adds a tab after it. **Open to the right**
  makes the second pane the first time, and adds a tab to it after that. A
  note already open in a pane's tab is shown there, not opened twice.
- **Closing** a tab shows the one after it, or the one before at the end;
  a pane's last tab closes the pane while the other is open. A note moved
  to the trash closes its tabs; a note merged into another is replaced by
  that note in its tabs.
- **Each pane has a key** of its own while it is open. What a pane asks of
  its note, blocks or source, where a link asked to go, and its requests,
  is kept by that key, so the right pane's editor keeps its state when the
  left pane closes, and a request goes to the focused pane's note alone.

**Focus follows the pointer and the keyboard**: clicking or tabbing into a
pane focuses it. Commands about a note, the export and history dialogs,
and links followed in a note act on the focused pane's note.

**Tabs** are a `tablist` above each pane: the arrows, Home and End move
between them and show them, Delete closes one, a middle click or its ×
closes it, and a right click opens the note's menu. The commands **Show
the next tab** (Ctrl+Tab; on a Mac, Control+Tab, since Command+Tab is the
system's), **Show the previous tab**, **Close the tab** (Mod+W) and **Open
the note to the right** are in the palette. In the sidebar, Ctrl or Cmd
and a click, or a middle click, opens a note in a new tab.

**Remembered** in the page's storage, by vault, as note IDs: the vault
opens to the tabs it had, those of notes it no longer has left out, the
note the app was started with shown in the focused pane. With none
remembered, the note open last opens, as before.

**Each pane fits its width**: the note's side panel and its properties
follow the width of the pane, through container queries, not the
window's.

## Alternatives

- **Obsidian's splits**: any number, either direction, tabs dragged
  between them. About twice the work and the testing, for a layout few
  need; the layout functions leave room for it.
- **Tabs without a split**: smaller, but no way to read one note beside
  another.
- **Tabs kept in the vault's folder**: they would travel with the folder
  and follow sync, but which notes are open is a device's, not the vault's.

## Consequences

- Two note views can be open at once, each with its editor; opening the
  app with two panes opens both notes.
- The editor's title has an ID of its own in the right pane
  (`note-title-right`), so each pane's rename finds its own.
- A note open in both panes is two views of its one document, shared as
  the editor and sync already share it, so an edit in one shows in the
  other at once.
- New windows, the next request, take a note out of these panes into a
  window of its own; how windows share notes is another decision.
