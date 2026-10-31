# 0020. Formulas in a language Nether reads and runs itself

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#databases-and-structure) ask for a
"formula property with a documented, sandboxed expression language (math,
text, date, logic, references to other properties)". A formula's text is
written by whoever writes the database's note, so it may come from a vault
someone else shared, and must not be able to do anything but work out a
value from the row's own values. People who know Obsidian's bases, Notion
or a spreadsheet should find it familiar.

## Decision

- **A small language of Nether's own, read and run by Nether.**
  `@nether/database` reads a formula with its own tokenizer and parser into
  a tree, and works it out with its own interpreter. Nothing in it is
  JavaScript's: no `eval`, no `Function`, no reach into objects. The only
  names it knows are the row's properties, `note.`, `formula.` and `file.`,
  and a fixed table of functions and methods.
- **Its syntax follows Obsidian's formulas**, which follow JavaScript's:
  `price * pages`, `if(done, "Yes", "No")`, `name.lower()`,
  `due + "1 week"`, `due.format("D MMM")`, `note["Big points"]`. A
  property's name alone reads its value, a date property as a date, a
  rollup's and another formula's as they work out.
- **Limits a formula cannot pass:** 2,000 characters, parts nested 64 deep,
  and 100,000 steps for one row; a formula that reads itself, directly or
  through others, is an error.
- **Errors stay in their cells.** A formula that cannot be read cannot be
  added; one that fails for a row, as one dividing by zero, shows why in
  that row's cell and counts as empty in filters and sorts.
- **A formula is worked out, never written**, as rollups are
  ([ADR 0019](0019-relations-are-links-both-ways-and-rollups-are-worked-out.md)):
  `type: formula` and `formula: price * 2` in the schema, nothing in the
  rows, and nothing in the Obsidian base for now.
- **The language is documented** on the documentation site's Formulas page,
  each operator, function and method with what it does.

## Alternatives

- **JavaScript run in a sandbox**, as a worker or an iframe. Powerful, but a
  formula would then be code: escaping a sandbox is a class of bug a small
  interpreter does not have, and a formula could loop for ever.
- **An existing expression library.** Those that are small enough have their
  own syntax, rarely Obsidian's, and grow features a database does not
  need.
- **Writing formulas to the Obsidian base.** Obsidian would show them, but
  its functions and how they treat dates, empty values and links differ in
  ways its documentation does not settle; until they are checked against
  Obsidian, a formula Obsidian worked out differently would be worse than
  none.

## Consequences

- Every function is one Nether keeps: adding one is a change to the
  interpreter, its tests and its page.
- A formula that reads a related row's value goes through a rollup; a
  formula cannot follow a relation itself.
- Formulas show only in Nether, until a later change writes those Obsidian
  agrees on to the base.
