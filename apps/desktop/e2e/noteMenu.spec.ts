import { expect, test } from "@playwright/test";
import { errorsOf, openSample, openSampleTree, violations } from "./helpers.ts";

test("a note's menu opens on a right click and from the keyboard, and closes back", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const tree = await openSampleTree(page);
  const welcome = tree.getByRole("treeitem", { name: "Welcome" });
  await welcome.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Welcome: actions" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open",
    "Open in new tab",
    "Open to the right",
    "Rename…",
    "Make a copy",
    "Move to…",
    "Merge into…",
    "Add tags…",
    "Bookmark",
    "Copy link",
    "Copy path",
    "Copy full path",
    "Export…",
    "Version history",
    "Move to trash",
  ]);
  await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toBeFocused();
  expect(await violations(page)).toEqual([]);

  // The arrows go round, a letter goes to the next item starting with it.
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Move to trash" })).toBeFocused();
  await page.keyboard.press("c");
  await expect(menu.getByRole("menuitem", { name: "Copy link" })).toBeFocused();
  await page.keyboard.press("c");
  await expect(menu.getByRole("menuitem", { name: "Copy path" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Shift and F10 opens it for the focused row, and Escape gives the row its focus back.
  await welcome.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(welcome).toBeFocused();

  // A click elsewhere closes it.
  await welcome.click({ button: "right" });
  await page.mouse.click(600, 400);
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a note's menu tags, copies, moves, renames and trashes it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = errorsOf(page);
  const notes = await openSample(page);
  const menuOf = async (name: RegExp) => {
    await notes.getByRole("button", { name }).click({ button: "right" });
    return page.getByRole("menu");
  };

  // Tags: those it has, one offered from the vault, one new.
  await (await menuOf(/Ideas/)).getByRole("menuitem", { name: "Add tags…" }).click();
  const tags = page.getByRole("dialog", { name: "Tags of Ideas" });
  const field = tags.getByRole("combobox", { name: "Add a tag" });
  await expect(field).toBeFocused();
  expect(await violations(page)).toEqual([]);
  await field.fill("#to read");
  await page.keyboard.press("Enter");
  await field.fill("start");
  await page.keyboard.press("Enter");
  await expect(tags.locator(".property-chip")).toContainText(["#to-read", "#start"]);
  await tags.getByRole("button", { name: "Save" }).click();
  await expect(tags).toHaveCount(0);
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await page.getByRole("button", { name: "Markdown source" }).click();
  await expect(page.getByRole("textbox", { name: "Ideas, Markdown source" })).toContainText(
    /tags:\s*- to-read\s*- start/,
  );
  await page.getByRole("button", { name: "Markdown source" }).click();

  // Copy link and copy path.
  await (await menuOf(/Roadmap/)).getByRole("menuitem", { name: "Copy link" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Copied the link to Roadmap." }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("[[Roadmap]]");
  await (await menuOf(/Roadmap/)).getByRole("menuitem", { name: "Copy path" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Projects/Roadmap.md");

  // A copy, beside it, opened.
  await (await menuOf(/Roadmap/)).getByRole("menuitem", { name: "Make a copy" }).click();
  await expect(page.locator("#note-title")).toHaveText("Roadmap 2");
  await expect(notes.getByRole("button", { name: /Roadmap 2/ })).toContainText("Projects");

  // Moved to the vault's top.
  await (await menuOf(/Roadmap 2/)).getByRole("menuitem", { name: "Move to…" }).click();
  const move = page.getByRole("dialog", { name: "Move Roadmap 2 to a folder" });
  await expect(move.getByRole("option")).not.toContainText(["Projects"]);
  await move.getByRole("combobox", { name: "Find a folder" }).fill("top");
  await expect(move.getByRole("option")).toHaveText(["/ (the vault's top)"]);
  await page.keyboard.press("Enter");
  await expect(move).toHaveCount(0);
  await expect(notes.getByRole("button", { name: /Roadmap 2/ })).not.toContainText("Projects");

  // Renamed.
  await (await menuOf(/Roadmap 2/)).getByRole("menuitem", { name: "Rename…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename Roadmap 2" });
  await rename.getByRole("textbox", { name: "Name" }).fill("Plan B");
  await page.keyboard.press("Enter");
  await expect(rename).toHaveCount(0);
  await expect(notes.getByRole("button", { name: /Plan B/ })).toBeVisible();

  // To the trash.
  await (await menuOf(/Plan B/)).getByRole("menuitem", { name: "Move to trash" }).click();
  await expect(notes.getByRole("button", { name: /Plan B/ })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Plan B is in the trash." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
