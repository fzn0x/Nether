// The performance targets that need a window, on the reference vault in
// the browser preview, drawn by Chromium as WebView2 draws the desktop app:
// switching notes, from the click to the frame that shows the note, and
// typing, from each key to the frame that shows it, as the browser's Event
// Timing reports them. The targets without a window are in tools/perf.
//
//   pnpm --filter @nether/desktop perf:ui            # 50,000 notes
//   NETHER_PERF_NOTES=5000 pnpm --filter @nether/desktop perf:ui
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const notes = Number(process.env.NETHER_PERF_NOTES ?? "50000");
const out = process.env.NETHER_PERF_OUT ?? "perf-ui-report.json";

function percentile(times: readonly number[], p: number): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

test("switching notes and typing stay within their targets", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await page.goto(`/?reference=${String(notes)}`);
  await page.getByRole("button", { name: "Open a folder" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click({ timeout: 10 * 60_000 });
  const list = page.getByRole("list", { name: "Notes" });
  await expect(page.getByText(`${notes.toLocaleString("en")} notes`)).toBeVisible();

  // The editor loads the first time a note opens; that is not switching.
  await list.getByRole("button").first().click();
  await expect(page.locator("[aria-label$=', note text']")).toBeVisible({ timeout: 60_000 });

  const switchTimes: number[] = [];
  // The rows in view, twenty, twice over: forty switches, each to another note.
  for (let switched = 0; switched < 40; switched++) {
    const index = (switched % 20) + 1;
    switchTimes.push(
      await page.evaluate(async (row) => {
        const button = document.querySelectorAll<HTMLButtonElement>(".note-list li button")[row];
        if (button === undefined) throw new Error(`No row ${String(row)} in the list.`);
        const title = button.querySelector(".note-title")?.textContent ?? "";
        const start = performance.now();
        button.click();
        // Until the note's text shows, then the frame that draws it.
        for (;;) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const editor = document.querySelector(`[aria-label="${CSS.escape(title)}, note text"]`);
          if (editor !== null && editor.childElementCount > 0) break;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return performance.now() - start;
      }, index),
    );
  }

  // Typing, once the link index has read the vault, as it has on every open
  // but the first, since it keeps what it read.
  await expect(page.getByText(/^Reading links:/)).toHaveCount(0, { timeout: 15 * 60_000 });
  // Typing at the end of the open note, a key at a time as people type.
  const editor = page.locator("[aria-label$=', note text']");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.evaluate(() => {
    const durations = new Map<number, number>();
    (globalThis as unknown as { keyDurations: Map<number, number> }).keyDurations = durations;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.interactionId === 0) continue;
        durations.set(
          entry.interactionId,
          Math.max(durations.get(entry.interactionId) ?? 0, entry.duration),
        );
      }
    }).observe({
      type: "event",
      durationThreshold: 16,
      buffered: false,
    } as PerformanceObserverInit);
  });
  const text = " The quick brown fox jumps over the lazy dog, and types on.".repeat(2);
  await page.keyboard.type(text, { delay: 40 });
  await page.waitForTimeout(500);
  const slow = await page.evaluate(() => [
    ...(globalThis as unknown as { keyDurations: Map<number, number> }).keyDurations.values(),
  ]);
  // The Event Timing API reports only keys of 16 ms or more; the others took less.
  const keyTimes = [
    ...slow,
    ...Array.from({ length: Math.max(0, text.length - slow.length) }, () => 8),
  ];
  const heapMB = await page.evaluate(() =>
    Math.round(
      ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
        0) /
        2 ** 20,
    ),
  );

  const round = (ms: number) => Math.round(ms * 10) / 10;
  const targets = [
    { name: "Switching notes", p95: round(percentile(switchTimes, 95)), limit: 100 },
    // Event Timing rounds to 8 ms: 16 is the frame the key is drawn in.
    { name: "Typing, key to frame", p95: round(percentile(keyTimes, 95)), limit: 16 },
  ].map((target) => ({ ...target, met: target.p95 <= target.limit }));
  writeFileSync(
    out,
    `${JSON.stringify({ vault: { notes, seed: 1 }, heapMB, keys: text.length, slowKeys: slow.length, targets }, null, 2)}\n`,
  );
  for (const target of targets) {
    expect(target.p95, `${target.name}: p95 ${String(target.p95)} ms`).toBeLessThanOrEqual(
      target.limit,
    );
  }
});
