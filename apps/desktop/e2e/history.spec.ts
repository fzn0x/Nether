import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample, settle, violations } from "./helpers.ts";

/** A file of the sample vault, as the app last wrote it. */
async function fileText(page: Page, path: string): Promise<string> {
  return page.evaluate(async (file) => {
    const preview = (
      globalThis as unknown as {
        netherPreview: { files: { read(path: string): Promise<{ text: string }> } };
      }
    ).netherPreview;
    return (await preview.files.read(file)).text;
  }, path);
}

async function runCommand(page: Page, name: string) {
  await page.keyboard.press("Control+p");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Command" }).fill(name);
  await expect(palette.getByRole("option").first()).toHaveText(name);
  await page.keyboard.press("Enter");
}

test("a note's history shows what changed since a version, and puts it back", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Roadmap/ }).click();
  const before = await fileText(page, "Projects/Roadmap.md");
  await page.getByRole("button", { name: "Markdown source" }).click();
  const source = page.getByRole("textbox", { name: "Roadmap, Markdown source" });
  await expect(source).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nA line to take back.\n");
  await settle(page);
  // Saved: the text it replaced is the note's first version.
  await expect.poll(() => fileText(page, "Projects/Roadmap.md")).toContain("A line to take back.");

  await runCommand(page, "Show the note's history");
  const dialog = page.getByRole("dialog", { name: "History of Roadmap" });
  const versions = dialog.getByRole("group", { name: "Versions" }).getByRole("radio");
  await expect(versions).toHaveCount(1);
  await expect(versions.first()).toBeChecked();
  const changes = dialog.getByRole("region", { name: "Changes from this version to the note now" });
  await expect(changes.locator("ins")).toContainText("A line to take back.");
  await expect(changes.locator("del")).toHaveCount(0);
  expect(await violations(page)).toEqual([]);

  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => fileText(page, "Projects/Roadmap.md")).toBe(before);
  await expect(source).not.toContainText("A line to take back.");

  // The note as it was before the restore is kept: the restore can be undone.
  await runCommand(page, "Show the note's history");
  await expect(versions).toHaveCount(2);
  await expect(changes.locator("del")).toContainText("A line to take back.");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
