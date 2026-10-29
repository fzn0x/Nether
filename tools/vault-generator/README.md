# @nether/vault-generator

Generates the reference vault that Nether's performance targets are
measured on: 50,000 Markdown notes laid out and linked the way real vaults
are. The same seed and size always give the same files, byte for byte, on
every platform, so numbers measured on two machines or two commits compare
the same vault.

```sh
pnpm vault:generate                                    # 50,000 notes, seed 1, into .vaults/reference
pnpm vault:generate --notes 1000 --seed 7 --out .vaults/small
```

`.vaults/` is ignored by Git. The generator refuses to write into a folder
that holds anything other than a vault it generated, and replaces one it
did.

## What a vault holds

With the default size and seed, about 62 MB:

| | |
| --- | --- |
| Notes | 43,540 notes in project, area, resource and archive folders, a fifth with a block that others link to |
| Daily notes | 1,460, four years of them, in `Daily/<year>/` |
| Database rows | 5,000, a thousand in each of five folders (`Databases/Tasks`, `Books`, `Meetings`, `People`, `Projects`), with typed frontmatter |
| Links | About 246,000: wiki links, aliased links, links to headings and blocks, embeds, and links in frontmatter properties; 1% point to notes nobody wrote yet |
| Syntax | Frontmatter, headings, lists and task lists, quotes, callouts, code blocks, tables, math and tags |

Links follow Zipf's law, as in real vaults: a few notes are linked from
everywhere and most from a handful. `.nether-vault.json`, at the vault's
root, records the generator version, seed, size and these counts.

## Changing it

A test pins a hash of the output for one seed and size. A change that
alters the output must bump `generatorVersion` in `src/generate.ts` and
update that hash, because it changes the vault every earlier measurement
was made on.
