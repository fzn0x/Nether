import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample, settle } from "./helpers.ts";

const sourceOf = (page: Page, title: string) =>
  page.getByRole("textbox", { name: `${title}, Markdown source` });

test("source mode shows a note's Markdown, and edits there come back as blocks", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const toggle = page.getByRole("button", { name: "Markdown source" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const source = sourceOf(page, "Welcome");
  await expect(source).toBeFocused();
  // The file's own syntax, frontmatter and wiki link as written.
  await expect(source).toContainText("tags: [start]");
  await expect(source).toContainText("[[Projects/Roadmap|the roadmap]]");

  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n## Added in source\n");
  await settle(page);
  // Ctrl or Cmd and / go back to blocks, with the edit.
  await page.keyboard.press("ControlOrMeta+/");
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await expect(editor).toBeFocused();
  await expect(editor.getByRole("heading", { level: 2 })).toHaveText("Added in source");
  await expect(editor.locator(".chip-wikiLink")).toHaveText("the roadmap");

  // The mode stays from note to note, and the edit was saved.
  await page.keyboard.press("ControlOrMeta+/");
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await expect(sourceOf(page, "Ideas")).toContainText("$e^{i\\pi}$");
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await expect(sourceOf(page, "Welcome")).toContainText("## Added in source");
  await expect(sourceOf(page, "Welcome")).toContainText("[[Projects/Roadmap|the roadmap]]");
  expect(errors).toEqual([]);
});

test("a line break written in source stays a new line when its paragraph is edited", async ({
  page,
}) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Roadmap/ }).click();
  await page.getByRole("button", { name: "Markdown source" }).click();
  // The source editor loads the first time, then takes focus.
  await expect(sourceOf(page, "Roadmap")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nfirst line\nsecond line\n");
  await settle(page);
  await page.keyboard.press("ControlOrMeta+/");
  const editor = page.getByRole("textbox", { name: "Roadmap, note text" });
  await editor.getByText("second line").click();
  await settle(page);
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  await settle(page);
  await page.keyboard.press("ControlOrMeta+/");
  // A new line, as written, not a hard break's backslash.
  const lines = (await sourceOf(page, "Roadmap").innerText()).split("\n");
  expect(lines).toContain("first line");
  expect(lines).toContain("second line more");
});

test("Vim keys work in source mode when they are on", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Roadmap/ }).click();
  await page.getByRole("button", { name: "Markdown source" }).click();
  await page.getByRole("checkbox", { name: "Vim keys" }).check();
  const source = sourceOf(page, "Roadmap");
  await source.click();
  // Normal mode: G goes to the last line, o opens one below it.
  await page.keyboard.press("Escape");
  await page.keyboard.type("Go");
  await page.keyboard.type("Typed in Vim");
  await page.keyboard.press("Escape");
  await expect(source).toContainText("Typed in Vim");
  // In normal mode, letters are commands, not text.
  await page.keyboard.type("x");
  await expect(source).not.toContainText("Typed in Vimx");
});
