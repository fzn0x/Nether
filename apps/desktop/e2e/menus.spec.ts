// The app's menus above the sidebar: every command in one of them, with its
// shortcut, those about a note shown but not chosen while none is open,
// and the keyboard moving between the menus and their items.
import { expect, test } from "@playwright/test";
import { openNote, openSample, violations } from "./helpers.ts";

test("the menus hold the commands, those about a note waiting for one", async ({ page }) => {
  await openSample(page);
  const bar = page.getByRole("menubar", { name: "Menus" });
  await bar.getByRole("menuitem", { name: "Note" }).click();
  const menu = page.getByRole("menu", { name: "Note" });
  const rename = menu.getByRole("menuitem", { name: /^Rename the note/ });
  await expect(rename).toHaveAttribute("aria-disabled", "true");
  await expect(rename).toHaveAttribute("aria-keyshortcuts", "F2");
  // Chosen while it cannot run, it does nothing and the menu stays.
  await rename.click({ force: true });
  await expect(menu).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(bar.getByRole("menuitem", { name: "Note" })).toBeFocused();
});

test("the graph and a new database open from the menus and the sidebar", async ({ page }) => {
  await openSample(page);
  await page.getByRole("menuitem", { name: "View" }).click();
  await page.getByRole("menuitem", { name: /^Open the graph/ }).click();
  await expect(page.getByRole("img", { name: /^A graph of 6 notes/ })).toBeVisible();
  await page.getByRole("button", { name: "New database" }).click();
  await expect(page.locator("#note-title")).toHaveText("Untitled database");
});

test("the keyboard moves between the menus and runs an item", async ({ page }) => {
  await openNote(page, "Ideas");
  const file = page.getByRole("menuitem", { name: "File" });
  await file.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitem", { name: "Note" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const note = page.getByRole("menu", { name: "Note" });
  await expect(note.getByRole("menuitem").first()).toBeFocused();
  // Right opens the menu after it.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "View" })).toBeVisible();
  await expect(note).toBeHidden();
  await page.keyboard.press("ArrowLeft");
  await expect(note).toBeVisible();
  await note.getByRole("menuitem", { name: /^Show the note as Markdown/ }).click();
  await expect(page.getByRole("textbox", { name: /Markdown source/ })).toBeVisible();
});
