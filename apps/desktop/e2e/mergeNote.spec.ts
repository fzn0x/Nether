import { expect, test } from "@playwright/test";
import { errorsOf, openSample, violations } from "./helpers.ts";

test("a note merged into another goes after its text, and to the trash", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await notes.getByRole("button", { name: /Ideas/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Merge into…" }).click();
  const dialog = page.getByRole("dialog", { name: "Merge Ideas into another note" });
  await expect(dialog).toContainText("Ideas's text goes after the other note's");
  // The note itself is not offered.
  await expect(dialog.getByRole("option")).not.toContainText(["Ideas"]);
  expect(await violations(page)).toEqual([]);

  await dialog.getByRole("combobox", { name: "Find a note" }).fill("welc");
  await expect(dialog.getByRole("option")).toHaveText(["Welcome"]);
  await expect(dialog.getByRole("button", { name: "Merge into Welcome" })).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);

  // Ideas was open, so Welcome opens in its place, with Ideas's text after its own.
  await expect(
    page.getByRole("status").filter({ hasText: "Merged Ideas into Welcome." }),
  ).toBeVisible();
  await expect(notes.getByRole("button", { name: /Ideas/ })).toHaveCount(0);
  await expect(page.locator("#note-title")).toHaveText("Welcome");
  await page.getByRole("button", { name: "Markdown source" }).click();
  const source = page.getByRole("textbox", { name: "Welcome, Markdown source" });
  await expect(source).toContainText("# Welcome to Nether");
  await expect(source).toContainText("# Ideas");
  await expect(source).toContainText("const answer: number = 42;");
  expect(errors).toEqual([]);
});
