# @nether/docs-site

The user, self-hosting, admin and plugin developer documentation, published
at https://fzn0x.github.io/nether/. It is built with
[Starlight](https://starlight.astro.build) on Astro; the pages are Markdown
in `src/content/docs/`.

A feature's documentation lands in the same pull request as the feature.
Contributor documentation (requirements, architecture, decision records)
stays in the repository's [`docs/`](../../docs/) folder.

## Work on it

Astro needs Node.js 22.23.4 or newer, newer than the rest of the
repository asks for.

```sh
pnpm --filter @nether/docs-site dev         # http://localhost:4321/nether/
pnpm --filter @nether/docs-site build       # the static site in dist/
pnpm --filter @nether/docs-site typecheck   # astro sync, then tsc
```

Astro collects anonymous usage data unless told not to; set
`ASTRO_TELEMETRY_DISABLED=1`, as CI does, or run `pnpm --filter
@nether/docs-site exec astro telemetry disable` once.

Pushing to `main` deploys the site to GitHub Pages.
