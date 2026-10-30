# @nether/perf

Measures Nether's [performance targets](../../docs/requirements.md#non-functional-requirements)
on the reference vault of 50,000 notes that
[`@nether/vault-generator`](../vault-generator/) writes. Three harnesses
share the work, each measuring the targets that need what it runs:

| Harness | Targets | Where it runs |
| --- | --- | --- |
| `pnpm perf:bench`, in Node.js | Title search under 50 ms, full-text search under 300 ms, and reading and parsing a note | CI, on every push |
| `pnpm --filter @nether/desktop perf:ui`, the desktop page in Chromium | Switching notes under 100 ms, and typing under 16 ms | CI, on every push |
| `tools/perf/desktop.ps1`, the desktop app on Windows | Opening to the last note under 1.5 s, idle memory under 300 MB, and picking up another app's edit within 2 s | A maintainer's machine, before each phase's gate |

Each writes what it measured and exits with 1 when a target is missed.

## In Node.js

```sh
pnpm perf:bench                        # 50,000 notes, seed 1, into perf-report.json
pnpm perf:bench --notes 5000 --out perf.json
```

The bench generates the vault in memory, opens it with the storage
package, fills the full-text index in SQLite (`node:sqlite`, with FTS5, as
the desktop app's SQLite has it), and times the desktop app's own search
code: six quick switcher queries ten times each, six searches with words,
phrases, filters and exclusions five times each, and reading and parsing
the 50 largest notes. It reports the 95th percentile of each.

## In Chromium

```sh
pnpm --filter @nether/desktop exec playwright install chromium   # once
pnpm --filter @nether/desktop perf:ui                            # 50,000 notes, into perf-ui-report.json
NETHER_PERF_NOTES=5000 pnpm --filter @nether/desktop perf:ui
```

The desktop page's preview opens the reference vault, generated in the
page, when its URL asks for `?reference=50000`. The test switches between
notes forty times, timing each from the click to the frame that shows the
note, then types at the end of a note and reads each key's time to the
frame that shows it from the browser's Event Timing. Chromium draws the
page as WebView2 does in the Windows app.

## In the desktop app

```powershell
pnpm vault:generate
pnpm --filter @nether/desktop build:app
powershell -File tools/perf/desktop.ps1 -Prepare   # once: reads every note, which takes minutes
# open a note in the vault, close the app, then:
powershell -File tools/perf/desktop.ps1            # 3 runs, each idle 60 s
```

The script starts the app on the vault with `NETHER_TRACE` set to a file,
where the app records how many milliseconds after its process started it
reached each point of its start (`Desktop.Mark`), and the time of day:

| Mark | When |
| --- | --- |
| `store-open` | The vault's index is open |
| `vault-listed`, `vault-open` | The vault's notes are listed, and the vault shows |
| `note-shown` | The last note's text shows: the startup target |
| `links-loaded` | The link index has loaded what it kept |
| `notes-read` | The link index has read every note it had not, all of them the first time |
| `heap-mb-N` | The page's JavaScript heap, 10, 30 and 60 s after the vault shows |
| `change-applied` | A change another app made to the vault is in its index |

It then waits while the app idles and sums the private working set of the
app's process and every process under it, the WebView2 browser, renderer,
GPU and utility processes, as Task Manager counts memory. Last, it writes a
note into the vault and times it from the write to the `change-applied`
that follows, then removes it. It measures a warm start, with the vault's
files in the system's cache; a start just after the machine boots reads
them from disk.

## What it took

The numbers of each phase's gate are in its
[report](../../docs/reports/), and how the desktop app meets the startup
and memory targets on a large vault is in
[ADR 0014](../../docs/adr/0014-load-a-vaults-links-lean-and-after-its-note.md).
