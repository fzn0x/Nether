import { expect, test } from "@playwright/test";
import { endOfFirstParagraph, errorsOf, openSample } from "./helpers.ts";

test("a note's panel shows its outline and the notes that link to it", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Roadmap/ }).click();
  const panel = page.getByRole("complementary", { name: "About this note" });
  await expect(panel.getByRole("button", { name: "Roadmap" })).toBeVisible();
  const linkedFrom = panel.getByRole("region", { name: "Linked from" });
  await expect(linkedFrom.getByRole("button", { name: "Welcome" })).toBeVisible();
  await expect(linkedFrom).toContainText("Notes are plain Markdown files");
  await linkedFrom.getByRole("button", { name: "Welcome" }).click();
  await expect(page.locator("#note-title")).toHaveText("Welcome");
  expect(errors).toEqual([]);
});

test("tags list the vault's notes with them", async ({ page }) => {
  const notes = await openSample(page);
  await page.getByRole("button", { name: "Tags" }).click();
  const tags = page.getByRole("list", { name: "Tags" });
  await expect(tags.getByRole("button")).toHaveText(["#start2"]);
  await tags.getByRole("button", { name: /start/ }).click();
  await expect(page.getByText("Notes tagged #start")).toBeVisible();
  await expect(notes.locator(".note-title")).toHaveText(["2026-10-30", "Welcome"]);
  await page.getByRole("button", { name: "Show all notes" }).click();
  await expect(notes.locator(".note-title")).toHaveCount(4);

  // A tag in a note shows the notes with it too.
  await notes.getByRole("button", { name: /2026-10-30/ }).click();
  await page.getByRole("textbox", { name: "2026-10-30, note text" }).locator(".chip-tag").click();
  await expect(page.getByText("Notes tagged #start")).toBeVisible();
});

test("a link to a heading opens its note there", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await endOfFirstParagraph(page, editor);
  await page.keyboard.type(" [[Ideas#Ideas]]");
  await editor.locator(".chip-wikiLink", { hasText: "Ideas#Ideas" }).click();
  await expect(page.locator("#note-title")).toHaveText("Ideas");
  const ideas = page.getByRole("textbox", { name: "Ideas, note text" });
  await expect(ideas).toBeFocused();
  // The caret is in the heading.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getSelection()?.anchorNode?.parentElement?.closest("h1")?.textContent,
      ),
    )
    .toBe("Ideas");
});

test("an embedded note shows its content, and its title opens it", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /2026-10-30/ }).click();
  const embed = page.getByRole("textbox", { name: "2026-10-30, note text" }).locator(".note-embed");
  await expect(embed).toContainText("Notes are plain Markdown files");
  await embed.getByRole("button", { name: "Welcome" }).click();
  await expect(page.locator("#note-title")).toHaveText("Welcome");
});
