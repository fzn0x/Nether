import { type Page, expect, test } from "@playwright/test";

/** Collects what the page writes to the console as errors, and what it throws. */
function errorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open a folder" }).click();
  return page.getByRole("list", { name: "Notes" });
}

test("the welcome screen names Nether and offers to open a folder", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Nether");
  await expect(page.getByRole("heading", { level: 1, name: "Nether" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open a folder" })).toBeVisible();
  await expect(page.getByText("Browser preview")).toBeVisible();
});

test("a vault lists its notes, and a note shows its Markdown", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  // Sorted by path, with each note's folder beside its title; the image is not a note.
  await expect(notes.locator(".note-title")).toHaveText([
    "2026-10-30",
    "Ideas",
    "Roadmap",
    "Welcome",
  ]);
  await expect(notes.locator(".note-folder")).toHaveText(["Daily", "Projects", "Projects"]);
  await expect(page.getByText("4 notes")).toBeVisible();

  await notes.getByRole("button", { name: /Roadmap/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Roadmap" })).toBeVisible();
  await expect(page.getByText("[!note] Local first")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the arrow keys move between notes", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("heading", { level: 1, name: "Roadmap" })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByRole("heading", { level: 1, name: "2026-10-30" })).toBeVisible();
  await expect(notes.getByRole("button", { name: /2026-10-30/ })).toBeFocused();
});

test("closing the vault goes back to the welcome screen", async ({ page }) => {
  await openSample(page);
  await page.getByRole("button", { name: "Close vault" }).click();
  await expect(page.getByRole("button", { name: "Open a folder" })).toBeVisible();
});
