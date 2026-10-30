import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample } from "./helpers.ts";

interface Entry {
  readonly path: string;
  readonly text?: string;
  readonly source?: string;
}

interface Made {
  readonly name: string;
  readonly kind: "zip" | "pdf";
  readonly entries: Entry[];
  readonly html?: string;
  readonly page?: { readonly size: string };
  readonly saved?: string;
}

/** The exports the preview kept, the latest last. */
async function exports(page: Page): Promise<Made[]> {
  return page.evaluate(
    () => (globalThis as unknown as { netherPreview: { exports: Made[] } }).netherPreview.exports,
  );
}

async function exportFrom(page: Page, note: RegExp, what: RegExp | string, as: RegExp) {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: note }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("radio", { name: what }).check();
  await dialog.getByRole("radio", { name: as }).check();
  return dialog;
}

test("a note exports as a web page, with the files it shows beside it", async ({ page }) => {
  const errors = errorsOf(page);
  const dialog = await exportFrom(page, /Roadmap/, /^Roadmap/, /Web pages/);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Saved to Roadmap\.zip\./);
  const [made] = await exports(page);
  expect(made?.kind).toBe("zip");
  expect(made?.entries.map((entry) => entry.path)).toEqual([
    "Projects/Roadmap.html",
    "attachments/sketch.svg",
  ]);
  const html = made?.entries[0]?.text ?? "";
  expect(html).toContain("<title>Roadmap</title>");
  expect(html).toContain('<h1 id="roadmap">Roadmap</h1>');
  expect(html).toContain('<aside class="callout" data-callout="note">');
  expect(html).toContain("<td>Local-first notes</td>");
  expect(html).toContain('<img src="../attachments/sketch.svg" alt="" width="240">');
  expect(made?.entries[1]).toEqual({
    path: "attachments/sketch.svg",
    source: "attachments/sketch.svg",
  });
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("the vault exports as web pages that link to each other, with an index", async ({ page }) => {
  const dialog = await exportFrom(page, /Welcome/, "The whole vault", /Web pages/);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Saved to Sample vault\.zip\./);
  const [made] = await exports(page);
  const byPath = new Map(made?.entries.map((entry) => [entry.path, entry]));
  expect([...byPath.keys()]).toEqual([
    "Daily/2026-10-30.html",
    "Projects/Ideas.html",
    "Projects/Roadmap.html",
    "Templates/Daily.html",
    "Templates/Meeting.html",
    "Welcome.html",
    "attachments/diagram.png",
    "attachments/sketch.svg",
    "index.html",
  ]);
  expect(byPath.get("Welcome.html")?.text).toContain(
    '<a class="internal-link" href="Projects/Roadmap.html">the roadmap</a>',
  );
  // An embedded note shows in place.
  expect(byPath.get("Daily/2026-10-30.html")?.text).toContain(
    '<div class="embed"><h1 id="welcome-to-nether">Welcome to Nether</h1>',
  );
  expect(byPath.get("index.html")?.text).toContain(
    '<a href="Projects/Ideas.html">Ideas</a> <small>Projects</small>',
  );
});

test("the vault exports as its Markdown files and every other file it holds", async ({ page }) => {
  const dialog = await exportFrom(page, /Welcome/, "The whole vault", /Markdown/);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Saved to/);
  const [made] = await exports(page);
  expect(made?.entries).toEqual(
    [
      "Daily/2026-10-30.md",
      "Projects/Ideas.md",
      "Projects/Roadmap.md",
      "Templates/Daily.md",
      "Templates/Meeting.md",
      "Welcome.md",
      "attachments/diagram.png",
      "attachments/sketch.svg",
    ].map((path) => ({ path, source: path })),
  );
});

test("a folder exports as a PDF, each note on its page, with math, code and diagrams drawn", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const dialog = await exportFrom(page, /Ideas/, "The Projects folder", /A PDF/);
  await dialog.getByRole("combobox", { name: "Paper" }).selectOption("letter");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Saved to Projects\.pdf\./, {
    timeout: 15_000,
  });
  const [made] = await exports(page);
  expect(made?.kind).toBe("pdf");
  expect(made?.page).toEqual({ size: "letter", landscape: false });
  const html = made?.html ?? "";
  expect(html).toContain('<article id="note-0"><h1 id="ideas">Ideas</h1>');
  // Properties come first, as Obsidian shows them.
  expect(html).toContain(
    '<article id="note-1"><dl class="properties"><dt>aliases</dt><dd>Plan</dd></dl><h1 id="roadmap">Roadmap</h1>',
  );
  expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
  expect(html).toContain('<span class="hljs-keyword">const</span>');
  expect(html).toContain('<figure class="diagram"><svg');
  // The print view is gone once printed.
  await expect(page.locator("#print-root")).toHaveCount(0);
  expect(errors).toEqual([]);
});
