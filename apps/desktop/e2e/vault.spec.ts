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
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
  const editor = page.getByRole("textbox", { name: "Roadmap, note text" });
  await expect(editor.locator(".callout-title")).toHaveText("Local first");
  await expect(editor.getByRole("table")).toContainText("Local-first notes");
  expect(errors).toEqual([]);
});

test("what is typed in a note is saved, and Markdown shortcuts make blocks", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Ideas/ }).click();
  const editor = page.getByRole("textbox", { name: "Ideas, note text" });
  await editor.locator("p").last().click();
  // The editor reads where a click put the caret when the browser reports
  // it, a frame later; keys pressed sooner would act where it was before.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## A new heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- first point");
  await expect(editor.getByRole("heading", { level: 2, name: "A new heading" })).toBeVisible();
  await expect(editor.locator("ul > li")).toHaveText("first point");
  // Leave the note and come back: it was saved to the vault.
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Ideas, note text" }).getByRole("heading", { level: 2 }),
  ).toHaveText("A new heading");
  expect(errors).toEqual([]);
});

test("the arrow keys move between notes", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
  await page.keyboard.press("Home");
  await expect(page.locator("#note-title")).toHaveText("2026-10-30");
  await expect(notes.getByRole("button", { name: /2026-10-30/ })).toBeFocused();
});

test("closing the vault goes back to the welcome screen", async ({ page }) => {
  await openSample(page);
  await page.getByRole("button", { name: "Close vault" }).click();
  await expect(page.getByRole("button", { name: "Open a folder" })).toBeVisible();
});
