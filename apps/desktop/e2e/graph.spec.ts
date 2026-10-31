// The graph view: the vault's notes and their links, every note's or those
// around one, kept to a filter, and a note opened from it.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { errorsOf, openNote } from "./helpers.ts";

test("the graph draws the notes and links, around a note or filtered, and opens a note", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await openNote(page, "Welcome");
  await page.keyboard.press("Control+p");
  await page.keyboard.type("open the graph");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toBeVisible();

  // The sample vault's notes; its daily note embeds Welcome, which links to the roadmap.
  const status = page.locator(".graph-status").getByRole("status");
  await expect(status).toHaveText("6 notes, 2 links.", { timeout: 15_000 });
  await expect(page.getByRole("img", { name: /^A graph of 6 notes/ })).toBeVisible();
  await expect(page.locator(".graph-canvas canvas").first()).toBeVisible();

  // Kept to a folder, by search's words.
  const filter = page.getByRole("searchbox", { name: "Filter" });
  await filter.fill("path:Projects");
  await expect(status).toHaveText(/^2 notes, 0 links\./);
  await filter.fill("");

  // Around the note that was open.
  await page.getByRole("radio", { name: "The notes around Welcome" }).check();
  await expect(status).toHaveText(/^3 notes, 2 links\./);
  await page.getByRole("combobox", { name: "Links away" }).selectOption("2");
  await expect(status).toHaveText(/^3 notes, 2 links\./);

  // Found from the keyboard, and opened.
  await page.getByRole("searchbox", { name: "Find a note" }).fill("road");
  await page.keyboard.press("Enter");
  const open = page.getByRole("button", { name: "Open Roadmap" });
  await expect(open).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await open.click();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
  await expect(page.getByRole("heading", { name: "Graph", level: 1 })).toHaveCount(0);

  // Back to the note it was opened from.
  await page.keyboard.press("Control+g");
  await page.getByRole("button", { name: "Back to Roadmap" }).click();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
  expect(errors).toEqual([]);
});
