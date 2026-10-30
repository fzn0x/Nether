import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample } from "./helpers.ts";

async function search(page: Page, text: string) {
  const field = page.getByRole("searchbox", { name: "Search the vault" });
  await field.fill(text);
  return page.getByRole("list", { name: "Notes found" });
}

test("search finds notes by their words, with the text around a match", async ({ page }) => {
  const errors = errorsOf(page);
  await openSample(page);
  // Ctrl or Cmd, Shift and F go to search.
  await page.keyboard.press("ControlOrMeta+Shift+F");
  await expect(page.getByRole("searchbox", { name: "Search the vault" })).toBeFocused();
  const found = await search(page, "plain markdo");
  await expect(found.locator(".note-title")).toHaveText(["Welcome"]);
  await expect(found.locator("mark").first()).toHaveText(/plain/i);
  await found.getByRole("button", { name: /Welcome/ }).click();
  await expect(page.locator("#note-title")).toHaveText("Welcome");
  expect(errors).toEqual([]);
});

test("search filters by tag, path and property, and leaves out what is excluded", async ({
  page,
}) => {
  await openSample(page);
  await page.getByRole("button", { name: "Search" }).click();
  let found = await search(page, "tag:start");
  await expect(found.locator(".note-title")).toHaveText(["2026-10-30", "Welcome"]);
  found = await search(page, "path:projects");
  await expect(found.locator(".note-title")).toHaveText(["Ideas", "Roadmap"]);
  found = await search(page, "prop:aliases=plan");
  await expect(found.locator(".note-title")).toHaveText(["Roadmap"]);
  found = await search(page, "-tag:start -path:Ideas");
  await expect(found.locator(".note-title")).toHaveText(["Roadmap"]);
  await search(page, "nothing-like-this");
  await expect(page.getByText("No notes match.")).toBeVisible();
});

test("the quick switcher opens a note by its name or alias", async ({ page }) => {
  await openSample(page);
  await page.keyboard.press("ControlOrMeta+O");
  const dialog = page.getByRole("dialog", { name: "Open a note" });
  const field = dialog.getByRole("combobox", { name: "Note to open" });
  await expect(field).toBeFocused();
  await page.keyboard.type("rdmp");
  await expect(dialog.getByRole("option").first()).toHaveText(/^RoadmapProjects$/);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");

  await page.keyboard.press("ControlOrMeta+O");
  await page.keyboard.type("plan");
  await expect(dialog.getByRole("option").first()).toHaveText(/^PlanRoadmap/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
