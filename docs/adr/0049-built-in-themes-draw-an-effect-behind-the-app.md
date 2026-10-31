# 0049. Built-in themes draw an effect behind the app

- Status: Accepted
- Date: 2026-11-01

## Context

Themes are CSS files of the vault
([ADR 0026](0026-themes-and-snippets-are-css-files-of-the-vault.md)):
they set Nether's design tokens and anything else CSS can. The maintainer
asked for two themes that CSS alone cannot make: **Anime**, with katakana
and hiragana flying in rainbow colors, and one where a grid of pixels
lights up around the mouse, each cell in its own color.

They suggested generating an anime background image with an image model.
An image is fixed where the kana are asked to fly, adds hundreds of
kilobytes to the app, and would bring a generated picture, whose terms and
likeness to others' work are unclear, into an AGPL repository.

The [non-functional requirements](../requirements.md#non-functional-requirements)
ask for WCAG 2.2 AA, an idle desktop under 300 MB, and typing under 16 ms.

## Decision

**Nether has built-in themes** beside the vault's: `nether:anime` and
`nether:pixels`, named with a colon, which no file in `.nether/themes` can
have on every system, so the names never meet. Each is a stylesheet bundled
with the app, applied as a vault's theme is, and an **effect**: a canvas
fixed behind everything (`z-index: -1`, no pointer), drawn in code. The
Appearance dialog lists them under **Built in**, the vault's under **This
vault's**; `.nether/appearance.json` keeps the choice as for any theme.

- **Anime** (`kana`): 24 to 70 kana, by the window's size, drift up and
  sway, each changing hue, at 30 frames a second.
- **Pixel grid** (`pixels`): a faint grid; around the pointer, cells light
  in a hue of their own, fixed by their place, and fade, while pixels
  scatter from where it moved. It draws only while something is lit or
  flying, and nothing at rest.

**Text keeps its contrast.** The sidebar and the note sit on panels of the
theme's colors at 78% to 86% opacity, so the brightest glyph or cell behind
them leaves text above 4.5:1; the margins show the effect whole.

**Motion is the user's to stop.** With reduced motion asked of the system,
the kana stand still and no pixels fly. Neither effect draws while the
window is hidden. The effect's code loads only when its theme is chosen.

## Alternatives

- **A generated background image**: still, heavy, and of unclear terms.
- **Effects as CSS animation of many elements**: hundreds of elements
  moving through the page's layout, where one canvas costs one layer.
- **Effects open to vault themes**, a script beside their CSS: themes would
  run code, which ADR 0026 keeps them from; built-in effects are Nether's
  own, reviewed with it.

## Consequences

- The Anime theme keeps drawing while the window shows, a small but steady
  cost the default theme does not have; the canvas holds up to 15 MB on a
  dense screen.
- A theme of the vault cannot draw an effect; the plugin API (Phase 4) is
  where that can come.
