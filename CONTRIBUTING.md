# Contributing

Thanks for helping! Bug reports, fixes, documentation and features are all
welcome. For a large change, please open an issue first so we can agree on
the approach before you spend time on it.

## Principles

The [requirements](docs/requirements.md) start with eight principles that
settle conflicts; the first ones matter most in review:

- **Users own their data.** Notes are Markdown files with YAML
  frontmatter, and nothing may lock content in a format of our own.
- **Local first.** The desktop app works fully offline with no account; a
  server is never needed for writing.
- **Everything is free.** One license, the AGPL-3.0-or-later, covers all
  of it. Enterprise features live in `enterprise/`, stay off until an admin
  turns them on, and nothing outside that folder depends on them. Never add
  a license key, a paywall or a feature that only works on a paid service.
- **Private by default.** No telemetry unless the user opts in.

## Set up

You need:

- [Node.js](https://nodejs.org) 24 (22.13 at least, for the built-in
  `node:sqlite` the storage tests use; the documentation site needs 22.23.4
  or newer). `.nvmrc` names the version.
- [pnpm](https://pnpm.io) 10 (`npm install --global pnpm@10`). In this
  repository it switches itself to the version that `packageManager` in
  `package.json` pins.
- [Go](https://go.dev/dl/) 1.27, for the desktop app.

```sh
pnpm install          # also installs the Git hooks
```

Turborepo and Astro collect anonymous usage data unless told not to. Set
`TURBO_TELEMETRY_DISABLED=1` and `ASTRO_TELEMETRY_DISABLED=1`, as CI does,
or run `pnpm exec turbo telemetry disable` and
`pnpm --filter @nether/docs-site exec astro telemetry disable` once.

## Before you send a pull request

```sh
pnpm lint             # ESLint, with typescript-eslint's strict, type-checked rules
pnpm format:check     # Prettier; `pnpm format` fixes it
pnpm typecheck
pnpm test             # Vitest; core needs at least 80% coverage
pnpm build
```

Some parts have checks of their own, which CI runs too:

| Part | Command |
| --- | --- |
| The desktop app's Go side | `go vet ./...` and `go test ./...` in `apps/desktop`, and `gofmt -l .` |
| The desktop page in Chromium | `pnpm --filter @nether/desktop exec playwright install chromium` once, then `pnpm --filter @nether/desktop test:e2e`, which checks every screen against WCAG 2.2 AA with axe too |
| The server with every enterprise feature off | `pnpm --filter @nether/server build`, then `pnpm --filter @nether/server smoke` |
| Dependency licenses | `node .github/scripts/check-licenses.mjs` |
| The performance targets on 50,000 notes | `pnpm perf:bench` and `pnpm --filter @nether/desktop perf:ui`; on Windows, `tools/perf/desktop.ps1`; all three in CI ([tools/perf](tools/perf/)) |

After changing a Go service the desktop page calls, run
`pnpm --filter @nether/desktop generate` and commit `src/mygo.ts`. The
package READMEs say how to run each app.

## How work is done

Nether ships phase by phase, as the [roadmap](docs/roadmap.md) lays out,
and inside a phase one feature at a time:

- **One feature, one pull request.** Its description starts with a plan:
  the requirement it meets, from [docs/requirements.md](docs/requirements.md),
  the design, the files it touches and how it is tested.
- **Tests come with the code.** A pull request is ready when lint, types,
  unit and end-to-end tests and the license check pass.
- **Decisions are recorded.** A significant decision gets an
  [Architecture Decision Record](docs/adr/) in the same pull request. So
  does any change to the Markdown export or the vault's file format, with
  a migration.
- **Documentation goes with the change**, in `apps/docs-site` for users and
  admins, or in `docs/` for contributors.
- **The changelog says what users notice.** Add an entry under
  `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), in the
  [Keep a Changelog](https://keepachangelog.com) format.

## Dependencies

Prefer fewer, well-maintained dependencies. Before adding one, check its
license against [ADR 0001](docs/adr/0001-license-agpl-and-dco.md), how
well it is maintained, and what it adds to the size of what we ship. pnpm
only installs versions that have been public for seven days.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org):
`type(scope): summary`, such as `fix(core): keep empty frontmatter values`.
Types are `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`
and `chore`; the scope is the package or app, such as `core`, `server`,
`desktop`, `docs-site` or `adr`. Keep each commit to one logical change
that builds and passes its tests, and use the body to say why.

Every commit is signed off. By adding a `Signed-off-by:` line, which
`git commit -s` writes for you, you certify the
[Developer Certificate of Origin](https://developercertificate.org/): that
you wrote the change or have the right to contribute it under the
project's license. You keep the copyright to your work; there is no
contributor license agreement. The Git hooks and CI check both the message
and the sign-off.

## Reporting bugs and security problems

Open a [bug report](https://github.com/fzn0x/Nether/issues/new/choose) with
the steps to reproduce it. Report security problems privately, as
[SECURITY.md](SECURITY.md) describes.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
