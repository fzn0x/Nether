# 0026. Themes and snippets are CSS files of the vault

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#extensibility) ask for "light/dark
themes, community themes, user CSS snippets". Until now Nether followed the
system's light or dark and had one look. Obsidian keeps a vault's
appearance in the vault, with themes and snippets as CSS files in its
`.obsidian` folder; but they style Obsidian's interface, whose elements and
classes Nether does not share. A directory of community themes to browse in
the app is a Phase 4 feature, with the plugin directory.

## Decision

- **Each vault keeps its appearance** in `.nether/appearance.json`: light,
  dark or as the system, its theme, and its snippets. It travels with the
  vault, as Obsidian's does. Without a vault open, the app follows the
  system.
- **The page says which it shows**: its root's `data-mode` is `light` or
  `dark` at all times, set from the vault's choice or the system's, and
  changed as the system changes when the vault follows it.
- **A theme is a CSS file in `.nether/themes`**, one at a time; **a snippet
  is one in `.nether/snippets`**, any number, applied in the order they were
  turned on. They go on the page after the app's own styles, the theme
  first, so a snippet can adjust a theme.
- **Nether's design tokens are what a theme sets**: `--bg`, `--text`,
  `--muted`, `--accent`, `--rule`, `--panel-shadow`, `--mark-bg` and the
  `--code-*` colors. The app's own rules for them weigh what `:root` does,
  through `:where()`, so a theme's `:root` rule replaces them in both modes,
  and `:root[data-mode="dark"]` in dark alone. The graph and diagrams read
  the tokens and the mode as the page has them.
- **A change shows and is kept at once**; Reload reads the files again
  after they are edited, as Nether does not watch its own folder.
- **Exports keep Nether's own look**, which a reader without the theme
  sees ([ADR 0012](0012-export-from-the-page.md)): the theme and snippets
  are styles for the screen, which a PDF does not print, and exported web
  pages carry Nether's own style.
- **Obsidian's themes and snippets are not read**: they would style
  elements Nether does not have.

## Alternatives

- **Themes as a list of token values, in JSON.** Nothing but colors could
  change, and nothing could load from the web, but snippets need CSS
  anyway, and themes need more than colors to differ.
- **One appearance for the app, not per vault.** Simpler, but a vault
  synced to another device, or shared, would lose its look; Obsidian users
  expect it in the vault.
- **Applying Obsidian's theme files.** They target another interface; the
  result would be broken colors, not a theme.

## Consequences

- The design tokens are now part of Nether's public interface: renaming or
  removing one breaks themes, and is a change for the changelog and the
  theme documentation.
- A theme or snippet can load fonts and images from the web, as any CSS
  can. Turning one on is the user's choice, as in Obsidian; the
  documentation says so.
- A theme's contrast is its author's to meet; the app's own colors stay
  checked against WCAG 2.2 AA.
- The Phase 4 directory installs a theme by writing its file to
  `.nether/themes`.
