import { expect, test } from "@playwright/test";
import { endOfFirstParagraph, errorsOf, openNote, settle } from "./helpers.ts";

test("math, code and diagrams render in a note", async ({ page }) => {
  const errors = errorsOf(page);
  const editor = await openNote(page, "Ideas");
  await expect(editor.locator(".math-inline .katex")).toBeVisible();
  await expect(editor.locator(".math-block .katex-display")).toBeVisible();
  await expect(editor.locator(".hljs-keyword").first()).toHaveText("const");
  await expect(editor.getByRole("textbox", { name: "Language" }).first()).toHaveValue("ts");
  // Mermaid loads with the first diagram.
  await expect(editor.locator(".diagram svg")).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("the slash menu inserts blocks, and math opens for its LaTeX", async ({ page }) => {
  const errors = errorsOf(page);
  const editor = await openNote(page, "Welcome");
  await endOfFirstParagraph(page, editor);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Blocks" });
  await expect(menu.getByRole("option")).toHaveCount(19);
  await page.keyboard.type("mat");
  await expect(menu.getByRole("option")).toHaveText(["Math"]);
  // The note keeps focus and points at the highlighted block.
  const option = await menu.getByRole("option").first().getAttribute("id");
  await expect(editor).toHaveAttribute("aria-activedescendant", option ?? "");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();

  const latex = page.getByRole("textbox", { name: "LaTeX" });
  await expect(latex).toBeFocused();
  await page.keyboard.type("a^2 + b^2 = c^2");
  await page.keyboard.press("Escape");
  await expect(latex).toBeHidden();
  await expect(editor.locator(".math-block .katex")).toBeVisible();
  // The math stays selected, and Enter opens it again.
  await page.keyboard.press("Enter");
  await expect(latex).toHaveValue("a^2 + b^2 = c^2");
  await page.keyboard.press("Escape");

  // Escape closes the menu and leaves the slash as text.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(editor.locator("p").last()).toHaveText("/");
  expect(errors).toEqual([]);
});

test("a diagram that asks for the ELK layout says it is not included", async ({ page }) => {
  const editor = await openNote(page, "Welcome");
  await endOfFirstParagraph(page, editor);
  await page.keyboard.press("Enter");
  await page.keyboard.type("```mermaid ");
  for (const line of ["---", "config:", "  layout: elk", "---", "flowchart LR", "  A --> B"]) {
    await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  }
  await expect(editor.locator(".diagram-error")).toContainText(
    "Nether does not include the ELK layout",
    { timeout: 15_000 },
  );
});

test("the block handle's menu duplicates, moves and turns blocks", async ({ page }) => {
  const errors = errorsOf(page);
  const editor = await openNote(page, "Welcome");
  const paragraph = editor.locator("p").first();
  await paragraph.hover();
  const grip = page.getByRole("button", { name: "Drag to move, or click for the block's menu" });
  await grip.click();
  const menu = page.getByRole("menu", { name: "Block" });
  // The menu takes focus, and the arrow keys move through it.
  await expect(menu.getByRole("menuitem", { name: "Text" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  await menu.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(menu).toBeHidden();
  await expect(editor.locator("p")).toHaveCount(2);

  await editor.locator("p").first().hover();
  await grip.click();
  await menu.getByRole("menuitem", { name: "Heading 2" }).click();
  await expect(editor.locator("h2")).toHaveCount(1);
  await expect(editor.locator("> *")).toHaveText([
    "Welcome to Nether",
    /^Notes are plain/,
    /^Notes are plain/,
  ]);

  // Each action has a shortcut for the block that holds the caret.
  await editor.locator("h1").click();
  await settle(page);
  await page.keyboard.press("ControlOrMeta+Shift+ArrowDown");
  await expect(editor.locator("> *").nth(1)).toHaveText("Welcome to Nether");
  await page.keyboard.press("ControlOrMeta+d");
  await expect(editor.locator("h1")).toHaveCount(2);
  expect(errors).toEqual([]);
});
