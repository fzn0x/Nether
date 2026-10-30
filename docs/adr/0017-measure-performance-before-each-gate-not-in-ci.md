# 0017. Measure performance before each phase's gate, not in CI

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#non-functional-requirements) set
performance targets on a reference vault of 50,000 notes, and the project's
brief asked CI to measure them. Since
[ADR 0014](0014-load-a-vaults-links-lean-and-after-its-note.md), CI's
Performance job ran two of the three harnesses on every push: searches and
parsing in Node.js, and switching notes and typing in Chromium. A third
job, on Windows, was proposed for the desktop app's start, memory and
pickup.

The targets are times measured to the frame and memory measured to the
megabyte, on shared runners whose speed varies from one run to the next.
The same commit passed on one runner and failed on another: switching notes
at 109 ms against a limit of 100 ms, typing at 24 ms against 16 ms, with
that runner about a quarter slower than the others at the same work. A failure
blocked a merge until it was run again, and taught nothing the next run did
not contradict. The maintainer chose to take the measurements out of CI.

## Decision

- **CI does not measure performance.** No job runs `pnpm perf:bench`,
  `pnpm --filter @nether/desktop perf:ui` or `tools/perf/desktop.ps1`.
- **The harnesses stay, and run before each phase's gate**, on the
  maintainer's machine, on the reference vault; the phase's report gives
  their numbers, as the Phase 1 report does.
- **A change that may cost time or memory on a large vault says so in its
  pull request**, with the harness's numbers before and after, as
  [#25](https://github.com/fzn0x/Nether/pull/25) and
  [#28](https://github.com/fzn0x/Nether/pull/28) did.

## Alternatives

- **Keeping the jobs, but not failing on a missed target.** They would
  still take minutes of every push and report numbers too noisy to act
  on; a slow runner would read as a regression.
- **Measuring several times and keeping the best**, or allowing a margin on
  runners. Either hides a real regression of the same size as the noise.
- **A dedicated machine for the measurements.** Steady numbers, but one
  more machine to keep running and secure.

## Consequences

- A regression can land unmeasured between gates; the reports catch it at
  the latest at the next gate, and the pull request's own numbers sooner.
- Pushes finish sooner: the Performance job took about four minutes.
- The requirement that CI measure the targets is replaced by this record;
  the targets themselves stand.
