import { expect, test } from "@playwright/test";
import { endOfFirstParagraph, errorsOf, openSample } from "./helpers.ts";

test("[[ suggests notes by title and alias, and a link opens its note", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await endOfFirstParagraph(page, editor);
  await page.keyboard.type(" See [[Ide");
  const menu = page.getByRole("listbox", { name: "Notes" });
  await expect(menu.getByRole("option").first()).toHaveText(/^IdeasProjects$/);
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  const ideas = editor.locator(".chip-wikiLink", { hasText: "Ideas" });
  await expect(ideas).toBeVisible();

  // An alias: the link shows it, and leads to the note it names.
  await page.keyboard.type(" and [[Pla");
  await expect(menu.getByRole("option").first()).toHaveText(/^PlanRoadmap$/);
  await page.keyboard.press("Enter");
  const plan = editor.locator(".chip-wikiLink", { hasText: "Plan" });
  await expect(plan).toBeVisible();

  await ideas.click();
  await expect(page.locator("#note-title")).toHaveText("Ideas");
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page
    .getByRole("textbox", { name: "Welcome, note text" })
    .locator(".chip-wikiLink", { hasText: "Plan" })
    .click();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
  expect(errors).toEqual([]);
});

test("[[ suggests a note's headings after #", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await endOfFirstParagraph(page, editor);
  await page.keyboard.type(" [[Roadmap#Ro");
  const menu = page.getByRole("listbox", { name: "Notes" });
  await expect(menu.getByRole("option")).toHaveText(["RoadmapRoadmap"]);
  await page.keyboard.press("Enter");
  await expect(editor.locator(".chip-wikiLink", { hasText: "Roadmap#Roadmap" })).toBeVisible();
});

test("a link typed in full to a note not yet written makes the note when opened", async ({
  page,
}) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await endOfFirstParagraph(page, editor);
  await page.keyboard.type(" [[Next steps]]");
  const link = editor.locator(".chip-wikiLink", { hasText: "Next steps" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator("#note-title")).toHaveText("Next steps");
  await expect(page.getByText("7 notes")).toBeVisible();
});

test("[[Note#^ finds a block by its text, and links to it by an ID written after it", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await endOfFirstParagraph(page, editor);
  await page.keyboard.type(" See [[Ideas#^highlight");
  const menu = page.getByRole("listbox", { name: "Notes" });
  await expect(menu.getByRole("option").first()).toHaveText(
    /^A highlight, some e\^\{i\\pi\} and a hidden comment\.Ideas$/,
  );
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();

  const read = (path: string) =>
    page.evaluate(
      async (file) =>
        (
          await (
            globalThis as unknown as {
              netherPreview: { files: { read(path: string): Promise<{ text: string }> } };
            }
          ).netherPreview.files.read(file)
        ).text,
      path,
    );
  // The block's note writes its ID after it, as Obsidian does.
  await expect.poll(() => read("Projects/Ideas.md")).toMatch(/hidden comment%%\. \^[a-z0-9]+\n/);
  const id = /%%\. \^([a-z0-9]+)\n/.exec(await read("Projects/Ideas.md"))?.[1] ?? "";
  await expect.poll(() => read("Welcome.md")).toContain(`[[Ideas#^${id}]]`);

  // The link opens the note there.
  await editor.locator(".chip-wikiLink", { hasText: "Ideas" }).click();
  await expect(page.locator("#note-title")).toHaveText("Ideas");
  expect(errors).toEqual([]);
});
