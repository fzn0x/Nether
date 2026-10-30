// Measures Nether's performance targets that do not need a window, on the
// reference vault: the quick switcher's title search, full-text search with
// SQLite's FTS5 as the desktop app runs it, and reading and parsing a note,
// the part of switching notes before it is drawn. Opening and indexing the
// vault are measured too, for the record. It writes the numbers to a JSON
// report and exits with 1 when a target is missed.
//
//   pnpm perf:bench                      # 50,000 notes, seed 1
//   pnpm perf:bench --notes 5000 --out perf.json
import { writeFileSync } from "node:fs";
import { LinkGraph, indexNote, plainText } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";
import { parseQuery } from "@nether/search";
import { MemoryFiles, type NoteEntry, SqliteStore, Vault } from "@nether/storage";
import { generateVault } from "@nether/vault-generator";
// The desktop app's own search, so the numbers are those of the code users run.
import { searchVault, switcherMatches } from "../../../apps/desktop/src/search.ts";
import { nodeDatabase } from "./database.ts";

interface Target {
  readonly name: string;
  /** The 95th percentile, in milliseconds, of the times measured. */
  readonly p95: number;
  readonly limit: number;
  readonly met: boolean;
}

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

function percentile(times: readonly number[], p: number): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

async function time<T>(task: () => Promise<T> | T): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await task();
  return { result, ms: performance.now() - start };
}

/** Runs a task `runs` times after a warm-up, and gives each run's time. */
async function repeat(runs: number, task: () => unknown): Promise<number[]> {
  await task();
  const times: number[] = [];
  for (let run = 0; run < runs; run++) times.push((await time(task)).ms);
  return times;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

const notes = Number(option("notes", "50000"));
const seed = Number(option("seed", "1"));
const out = option("out", "perf-report.json");
const log = (text: string) => {
  process.stdout.write(`${text}\n`);
};

log(`The reference vault: ${String(notes)} notes, seed ${String(seed)}`);
const generated = await time(() => {
  const files: Record<string, string> = {};
  for (const file of generateVault({ notes, seed })) files[file.path] = file.content;
  return files;
});
const files = generated.result;
log(`  generated in ${String(round(generated.ms))} ms`);

const store = await SqliteStore.open(nodeDatabase());
const vault = new Vault(new MemoryFiles(files), store);
const opened = await time(() => vault.open());
const entries: readonly NoteEntry[] = vault.notes();
log(`  opened ${String(entries.length)} notes in ${String(round(opened.ms))} ms`);

// What the indexer does in its worker: each note's links, tags and text.
const graph = new LinkGraph();
const indexed = await time(async () => {
  const texts: { note: NoteEntry["id"]; title: string; body: string }[] = [];
  for (const note of entries) {
    const parsed = parseMarkdown(files[note.path] ?? "");
    graph.set(note.id, note.path, indexNote(parsed, parsed.writtenIds));
    texts.push({ note: note.id, title: note.title, body: plainText(parsed.content) });
    if (texts.length === 1000) await store.putNoteTexts(texts.splice(0));
  }
  await store.putNoteTexts(texts);
});
log(`  indexed and filled the full-text index in ${String(round(indexed.ms))} ms`);

const targets: Target[] = [];
const target = (name: string, times: readonly number[], limit: number) => {
  const p95 = round(percentile(times, 95));
  targets.push({ name, p95, limit, met: p95 <= limit });
  log(
    `${p95 <= limit ? "met   " : "MISSED"} ${name}: p95 ${String(p95)} ms (target ${String(limit)} ms)`,
  );
};

// Titles, aliases and paths, as typed into the quick switcher.
const titleQueries = ["plan", "meeting", "proj alpha", "daily/2024", "q", "zzzz nothing"];
const titleTimes: number[] = [];
for (const query of titleQueries) {
  titleTimes.push(...(await repeat(10, () => switcherMatches(vault, graph, query))));
}
target("Title search, the quick switcher", titleTimes, 50);

// Words, phrases, filters and exclusions, as typed into search.
const textQueries = [
  "project",
  "weekly review",
  '"next steps"',
  "tag:project status",
  "meeting -archive",
  "path:Daily review",
];
const textTimes: number[] = [];
for (const query of textQueries) {
  textTimes.push(...(await repeat(5, () => searchVault(vault, graph, parseQuery(query)))));
}
target("Full-text search", textTimes, 300);

// The largest notes, read and parsed, as opening one does before the editor draws it.
const largest = [...entries].sort((a, b) => b.size - a.size).slice(0, 50);
const openTimes: number[] = [];
for (const note of largest) {
  openTimes.push(
    ...(await repeat(2, async () => {
      const file = await vault.read(note.id);
      return parseMarkdown(file.text);
    })),
  );
}
target("Reading and parsing a note, the largest fifty", openTimes, 100);

const heap = process.memoryUsage().heapUsed / 2 ** 20;
log(`Memory: ${String(Math.round(heap))} MB of JavaScript heap, the vault's files included`);

const report = {
  vault: { notes, seed, files: Object.keys(files).length },
  setup: {
    generateMs: round(generated.ms),
    openMs: round(opened.ms),
    indexMs: round(indexed.ms),
    heapMB: Math.round(heap),
  },
  targets,
};
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
log(`Wrote ${out}`);
await store.close();
if (targets.some((each) => !each.met)) process.exitCode = 1;
