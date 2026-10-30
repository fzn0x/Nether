# 0015. Check every screen with axe, and lay out by direction, not by side

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#non-functional-requirements) ask for
WCAG 2.2 AA, full keyboard navigation and screen-reader labels on every
control, and for every interface string to be translatable from day one,
with right-to-left layout. The Phase 0 report put automated accessibility
checks in Phase 1, with the first real interface. Nether ships in English
only, and notes in any language: a vault may hold notes in Arabic or
Hebrew, or English notes with a paragraph in either.

## Decision

- **axe checks every screen in the end-to-end tests**, with
  `@axe-core/playwright`: the welcome screen, a vault with notes of every
  kind of block, the panels, source mode and each dialog, in the light
  theme and the dark one, against WCAG 2.0, 2.1 and 2.2 at A and AA. Any
  violation fails the tests, and a new screen or dialog adds itself to
  them.
- **Every dialog opens with focus in it**, on what it focuses itself or
  else its first control, and keeps it until it closes.
- **The page's direction follows the language of its messages**: `lang`
  and `dir` on the page are set from it, right to left for Arabic,
  Hebrew, Persian, Urdu and the other languages written so.
- **Styles say start and end, not left and right**: logical properties
  everywhere, in the app and in exported pages, so the layout mirrors
  with the page's direction; the file tree's arrow keys follow it too.
  CodeMirror's caret is the one rule left on a side, as CodeMirror draws
  it so in either direction.
- **Each block of a note reads in the direction of its own text**:
  paragraphs, headings, list items, quotes and cells take
  `unicode-bidi: plaintext`, and source mode lays each line out in its
  own direction, so the files hold nothing for it.

## Alternatives

- **Accessibility checked by hand only.** Hand checks with a screen
  reader stay needed, but they miss what a change breaks between them;
  axe catches names, roles and contrast on every push.
- **A `dir` attribute on every node of the editor**, as TipTap's
  `textDirection` option adds. It would put an attribute into every
  note's document and its Markdown round trip for what the browser can
  work out from the text.
- **A direction setting per note**, as some editors have. Mixed notes
  would still need it per paragraph, which `plaintext` gives for free.

## Consequences

- axe checks what a machine can: contrast, names, roles, landmarks and
  ARIA. Reading order, the meaning of names and how a screen reader
  sounds still need a person, before each release.
- A style written with left or right shows in review as a mistake; the
  right-to-left test catches what slips through on the screens it lays
  out.
- In a list whose items are in another direction than the page, the
  bullets stay on the page's side while the text aligns to its own.
