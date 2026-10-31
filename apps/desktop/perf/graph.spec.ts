// The graph view's target, smooth with 10,000 notes, on the reference
// vault in the browser preview, drawn by Chromium as WebView2 draws the
// desktop app: how long the graph takes to show, and the time between
// frames while it is laid out, and while it zooms once laid out.
//
//   pnpm --filter @nether/desktop perf:graph           # 10,000 notes
//   NETHER_PERF_GRAPH_NOTES=20000 pnpm --filter @nether/desktop perf:graph
import { writeFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

const notes = Number(process.env.NETHER_PERF_GRAPH_NOTES ?? "10000");

// The graph draws with WebGL on the GPU, as WebView2 draws it, not in
// software as headless Chromium otherwise does.
const angle =
  process.platform === "win32" ? "d3d11" : process.platform === "darwin" ? "metal" : "gl";
test.use({
  launchOptions: { args: [`--use-angle=${angle}`, "--enable-gpu", "--ignore-gpu-blocklist"] },
});
const out = process.env.NETHER_PERF_OUT ?? "perf-graph-report.json";

function percentile(times: readonly number[], p: number): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

/** The times between frames, in milliseconds, for as long as asked. */
function frameTimes(page: Page, ms: number): Promise<number[]> {
  return page.evaluate(
    (duration) =>
      new Promise<number[]>((resolve) => {
        const times: number[] = [];
        const start = performance.now();
        let last = start;
        const frame = (now: number) => {
          times.push(now - last);
          last = now;
          if (now - start < duration) requestAnimationFrame(frame);
          else resolve(times.slice(1));
        };
        requestAnimationFrame(frame);
      }),
    ms,
  );
}

test("the graph of the reference vault shows, lays out and zooms smoothly", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await page.goto(`/?reference=${String(notes)}`);
  await page.getByRole("button", { name: "Open a folder" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click({ timeout: 10 * 60_000 });
  await expect(page.getByText(`${notes.toLocaleString("en")} notes`)).toBeVisible();
  // The graph is the link index's: once it has read the vault.
  await expect(page.getByText(/^Reading links:/)).toHaveCount(0, { timeout: 15 * 60_000 });

  const opened = Date.now();
  await page.keyboard.press("Control+g");
  const status = page.locator(".graph-status").getByRole("status");
  await expect(status).toHaveText(
    new RegExp(`^${notes.toLocaleString("en")} notes|^${String(notes)} notes`),
    {
      timeout: 60_000,
    },
  );
  await expect(page.locator(".graph-canvas canvas").first()).toBeVisible();
  const showMs = Date.now() - opened;
  const links = Number(/, (\d+) links/.exec((await status.textContent()) ?? "")?.[1] ?? "0");

  // While ForceAtlas2 lays it out in its worker.
  const layoutFrames = await frameTimes(page, 3000);
  // While it zooms in and out, as the wheel would, once laid out.
  await expect(status).not.toContainText("Arranging", { timeout: 30_000 });
  await page.getByRole("button", { name: "Zoom in" }).click();
  const zoomFrames = await frameTimes(page, 1000);
  await page.getByRole("button", { name: "Zoom out" }).click();
  zoomFrames.push(...(await frameTimes(page, 1000)));

  const round = (ms: number) => Math.round(ms * 10) / 10;
  const targets = [
    { name: "Showing the graph", p95: showMs, limit: 3000 },
    // Thirty frames a second or better while it moves.
    { name: "Frames while laying out", p95: round(percentile(layoutFrames, 95)), limit: 33.4 },
    { name: "Frames while zooming", p95: round(percentile(zoomFrames, 95)), limit: 33.4 },
  ].map((target) => ({ ...target, met: target.p95 <= target.limit }));
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        vault: { notes, seed: 1 },
        links,
        longestLayoutFrame: round(Math.max(...layoutFrames)),
        longestZoomFrame: round(Math.max(...zoomFrames)),
        targets,
      },
      null,
      2,
    )}\n`,
  );
  for (const target of targets) {
    expect(target.p95, `${target.name}: p95 ${String(target.p95)} ms`).toBeLessThanOrEqual(
      target.limit,
    );
  }
});
