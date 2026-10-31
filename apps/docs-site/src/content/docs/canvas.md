---
title: Canvases
description: How to open and make canvases, Nether's infinite whiteboards of cards and arrows, kept in the open JSON Canvas format that Obsidian reads and writes too.
---

A canvas is a board as large as you need, holding cards and the arrows
between them: text, notes of the vault, images, web links, and groups
around them. Each canvas is a `.canvas` file in your vault, in the open
[JSON Canvas](https://jsoncanvas.org) format, so a canvas made in Obsidian
opens in Nether, and one made in Nether opens in Obsidian.

## Opening and making canvases

Canvases show in the sidebar's Folders and Pages views beside your notes,
marked **canvas**. Click one to open it in a tab, as a note opens; Ctrl or
Cmd and a click, or a middle click, opens it in a new tab. Right-click one,
or press Shift+F10 on it, to open it in a new tab or to the right, or to
move it to the trash.

To make one, choose **File**, then **New canvas**, or **New canvas here**
in a folder's menu. It starts empty, named "Untitled canvas".

## Adding and changing cards

- **Double-click** the board, or choose **Add text**, for a text card, and
  type; click elsewhere, press Escape, or Ctrl+Enter (Cmd+Enter) to finish.
  Double-click a text card to write in it again.
- **Add a note** picks a note of the vault and puts its card on the board.
- Click a card to select it, Shift and click to select more, and drag to
  move them; a group moves with the cards inside it. Drag the square at a
  selected card's corner to resize it.
- Drag from one of the dots on a selected card's sides to another card to
  draw an arrow between them. Click an arrow to select it.
- Right-click a card or an arrow for its menu: edit a card's text, connect
  it to another card, label an arrow, color either, or remove it.
- Delete or Backspace removes what is selected, and the arrows of a card
  removed. **Undo** and **Redo**, or Ctrl+Z and Ctrl+Shift+Z (Cmd on a
  Mac), go back and forth through your changes.

Nether saves the canvas a moment after each change.

## From the keyboard

Every card can be reached with Tab, in reading order. On a card:

| Key | What it does |
| --- | --- |
| Arrow keys | Move it |
| Alt and an arrow key | Resize it |
| Enter | Write in a text card, open a note, or open a link |
| Delete | Remove it |
| Shift+F10, or the menu key | Its menu, which also connects it to another card |
| Escape | Select nothing |

After the cards, a list of the canvas's connections appears as the
keyboard reaches it; Enter on one opens the arrow's menu.

## Moving around

- Drag the background, or drag with the middle button anywhere, to move
  across the board; scrolling moves it too.
- Hold Ctrl (Cmd on a Mac) and scroll, or pinch on a trackpad, to zoom
  where the pointer is. **Zoom in**, **Zoom out** and **Fit to view** are
  above the board; a canvas opens fitted to its tab.
- Click a note's card to open the note.

## Reading a canvas without seeing it

The cards are in reading order, top to bottom and along each row, so the
keyboard and screen readers go through them as they are read, each named
by its kind and its first words. After the cards, a list of connections
says which card leads to which, and the label of each arrow.

## Good to know

- A canvas changed by another app, or on another device, shows the change
  at once.
- If part of a canvas's file cannot be read, Nether shows the rest and
  says how many things it left out.
- A canvas syncs as other files of the vault do: changed on two devices at
  once, both are kept, the second as a copy.
- A canvas whose file has parts Nether cannot read is shown, but not
  changed, so saving it never loses them; open it in the app that made it.
- If another app changes a canvas while you change it here, the other
  app's change is kept and your last change is not; Nether says so.
