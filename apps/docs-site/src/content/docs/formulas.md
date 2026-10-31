---
title: Formulas
description: The formula language of Nether's databases, with every operator, function and method it has.
---

A formula is a property of a database whose value Nether works out for
each row from its other values: `Price * Count`, `if(Done, "Yes", "No")`,
`Due + "1 week"`. Add one from **Properties** in a database's view, with
the type **Formula**, and change it there later. A formula is worked out
each time the database shows, and never written to a row's file.

Formulas are their own small language, read and worked out by Nether, so a
formula from a vault someone shares with you can do nothing but work out a
value. Its syntax follows Obsidian's formulas.

## Values

- Numbers: `3`, `2.5`. Text, in double or single quotes: `"Done"`, with
  `\"` for a quote, `\n` for a new line and `\t` for a tab.
- `true`, `false` and `null`, which is nothing.
- Lists, in brackets: `[1, 2, 3]`.
- Dates, from date properties, `date()`, `today()` and `now()`. A formula's
  date is shown as its day, `2026-11-15`, with its time when it has one.

## Reading the row

| Write | To read |
| --- | --- |
| `Price` | The row's property of that name: a date property as a date, a rollup's or another formula's value as it works out |
| `note["Big points"]` | A property whose name has spaces or other signs |
| `note.Price`, `formula.Total` | The same, named in full |
| `file.name` | The row's name |
| `file.path` | The row's path in the vault |
| `file.mtime` | When the row's file was last changed |

A property the row does not have is `null`. A link, as a relation's value
`[[Acme]]`, reads as the name of the note it names when it is compared or
joined to text.

## Operators

| Operator | Does |
| --- | --- |
| `+` `-` `*` `/` `%` | Add, take away, multiply, divide and the remainder, on numbers; dividing by zero is an error |
| `+` | Joins text, when either side is text: `"Total: " + Total`; joins two lists |
| `date + "3 days"`, `date - "1 week"` | A date moved by a duration: `minutes`, `hours`, `days`, `weeks`, `months` or `years` |
| `date - date` | The days between two dates |
| `==` `!=` | Equal and not equal, for any values |
| `>` `<` `>=` `<=` | Compares numbers, text, dates and true or false; anything else is `false` |
| `&&` `\|\|` `!` | And, or and not |
| `( )` | Works out what is inside first |

Numbers and anything worked out with `null` give `null`, but text joined
to `null` is the text alone. In a condition, `null`, `false`, `0`, `""` and
`[]` count as false.

## Functions

| Function | Gives |
| --- | --- |
| `if(condition, then, else)` | `then` when the condition holds, else `else`, or `null` without one; only the one it gives is worked out |
| `min(…)`, `max(…)` | The least or most of numbers and lists of numbers |
| `abs(n)`, `floor(n)`, `ceil(n)` | The number without its sign, rounded down, rounded up |
| `round(n, digits)` | The number rounded, to as many decimals as `digits`, or none |
| `number(value)` | Text as a number, true as 1 and false as 0, or `null` |
| `text(value)` | Any value as text |
| `date(text)` | A date from `YYYY-MM-DD`, or with a time: `"2026-11-15 09:30"` |
| `today()`, `now()` | Today, from midnight, and this moment |

## Methods

Write a method after a value and a dot: `Name.lower()`. A method of `null`
gives `null`, so a missing value does not stop a formula.

| Of | Method | Gives |
| --- | --- | --- |
| Text | `length` | How many characters |
| Text | `lower()`, `upper()`, `trim()` | The text in lower case, upper case, or without spaces at its ends |
| Text | `contains(t)`, `startsWith(t)`, `endsWith(t)` | Whether it has `t`, case aside |
| Text | `slice(start, end)` | The characters from `start` up to `end` |
| Text | `replace(a, b)` | The text with every `a` written as `b` |
| Text | `split(separator)` | A list of the parts between separators |
| List | `length`, `first()`, `last()` | How many items; the first and the last |
| List | `contains(value)` | Whether it has the value |
| List | `join(separator)` | The items as text, between separators, or commas |
| List | `[0]`, `[-1]` | The item at a place, from the start or, below zero, the end |
| Number | `round(digits)`, `toFixed(digits)` | Rounded; as text with that many decimals |
| Date | `format(pattern)` | As text, by a pattern such as `"YYYY-MM-DD"` or `"dddd, MMMM Do"`, as templates write dates |
| Date | `year`, `month`, `day`, `hour`, `minute` | Its parts, months from 1 |
| Any | `isEmpty()` | Whether it is `null`, empty text or an empty list |

## When a formula cannot be worked out

A formula Nether cannot read, such as `Price *`, says why as you write it,
and cannot be added. One that cannot be worked out for a row, such as one
dividing by zero, shows **Error:** and why in that row's cell, and counts as
empty when the view filters and sorts. A formula can be at most 2,000
characters, nest 64 levels deep, and take 100,000 steps for a row; one that
reads itself, directly or through another, is an error too.
