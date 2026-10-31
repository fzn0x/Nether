---
title: Themes and appearance
description: How to show a vault light or dark, give it a theme, and adjust Nether with CSS snippets, and the design tokens a theme sets.
---

Each vault keeps its own appearance: light, dark or as your system is, a
theme, and any CSS snippets. Run **Appearance** from the command palette
(Ctrl+P, or Cmd+P on macOS). A change shows at once and is kept in the
vault's `.nether/appearance.json`, so the vault looks the same wherever you
open it. Without a vault open, Nether follows your system.

## Light or dark

**As the system** follows your system's setting as it changes, **Light** and
**Dark** keep to one whatever the system does.

## Built-in themes

Nether comes with two themes of its own, listed under **Built in**, each in
light and dark:

- **Anime**: violet nights or pastel mornings, with katakana and hiragana
  drifting up behind the app in rainbow colors.
- **Pixel grid**: a grid behind the app whose cells light up around the
  pointer, each in a color of its own, scattering pixels as it moves.

Your notes sit on a panel the effect shows through faintly, so text stays
easy to read; the margins show it whole. If your system asks for reduced
motion, the kana stand still and no pixels fly. The effects pause while
Nether's window is hidden. Anime keeps drawing while it shows, so on a
laptop running on battery, Nether's own theme uses less power.

## Themes

A theme is a CSS file in the vault's `.nether/themes` folder: `Ocean.css` is
the theme **Ocean**. Put the file there, open **Appearance**, click
**Reload**, and choose it under **Theme**; **Nether's own** goes back to
Nether's look. One theme applies at a time.

A theme sets Nether's design tokens, CSS custom properties on `:root`. A
rule for `:root` sets them for light and dark alike;
`:root[data-mode="dark"]` and `:root[data-mode="light"]` set them for one:

```css
:root {
  --accent: #2f6fd0;
}

:root[data-mode="dark"] {
  --bg: #0f1420;
  --text: #e6ebf5;
  --accent: #7fb0ff;
}
```

| Token | What it colors |
| --- | --- |
| `--bg` | The page behind everything |
| `--text` | Text |
| `--muted` | Quieter text, as hints, captions and the graph's dots |
| `--accent` | Links, the selection, buttons that act, and the open note in the graph |
| `--rule` | Lines and borders |
| `--panel-shadow` | The shadow under menus and dialogs |
| `--mark-bg` | Behind ==highlighted== text |
| `--sidebar-bg` | The sidebar; a shade off `--bg` unless set |
| `--hover`, `--pressed` | Behind a control under the pointer, and one pressed |
| `--code-keyword`, `--code-string`, `--code-number`, `--code-title`, `--code-type` | Highlighted code |

A theme can style anything else in Nether too, though class names may change
from one version to another; the tokens are kept, and a change to them is
noted in the changelog.

## CSS snippets

A snippet is a CSS file in the vault's `.nether/snippets` folder, for a
small change of your own, such as a wider page or another font. Under **CSS
snippets**, tick a snippet to turn it on; snippets apply after the theme, in
the order you turned them on, so they can adjust it. After you edit a
snippet's file, click **Reload**.

## The sidebar

Drag the sidebar's edge to make it wider or narrower; a line shows on the
edge when the pointer is on it. From the keyboard, Tab to the edge and press
the Left and Right arrows, or Home and End for its narrowest and widest.
Double-click the edge, or press Enter on it, for its first width. Nether
remembers the width on this device.

## Good to know

- Themes and snippets style the app. Exported web pages and PDFs keep
  Nether's own look, for readers without the theme.
- A theme or snippet can load fonts and images from the web, as any CSS
  can. Turn on only those you trust.
- Obsidian's themes and snippets style Obsidian's interface, which Nether
  does not share, so Nether does not read them.
- A theme's colors are its author's: Nether's own meet WCAG 2.2 AA
  contrast, but a theme's may not.
