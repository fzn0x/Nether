import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample } from "./helpers.ts";

/** A file of the sample vault, as the app last wrote it; undefined when it is not there. */
async function fileText(page: Page, path: string): Promise<string | undefined> {
  return page.evaluate(async (file) => {
    const preview = (
      globalThis as unknown as {
        netherPreview: {
          files: { read(path: string): Promise<{ text: string; missing?: boolean }> };
        };
      }
    ).netherPreview;
    const read = await preview.files.read(file);
    return read.missing === true ? undefined : read.text;
  }, path);
}

test.beforeEach(async ({ page }) => {
  // Friday, 6 November 2026: a day the sample has no note for.
  await page.clock.setFixedTime(new Date(2026, 10, 6, 9, 30));
});

test("the command palette finds a command by its name and runs it", async ({ page }) => {
  const errors = errorsOf(page);
  await openSample(page);
  await page.keyboard.press("Control+p");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const options = palette.getByRole("option");
  // Commands about a note wait for one to be open.
  await expect(options.filter({ hasText: "Rename the note" })).toHaveCount(0);
  await palette.getByRole("combobox", { name: "Command" }).fill("today");
  await expect(options.first()).toHaveText("Open today's noteCtrl+Shift+D");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.locator("#note-title")).toHaveText("2026-11-06");

  await page.keyboard.press("Control+p");
  await expect(options.filter({ hasText: "Rename the note" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  expect(errors).toEqual([]);
});

test("F2 renames the open note from its name", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await expect(page.locator("#note-title")).toHaveText("Ideas");
  await page.keyboard.press("F2");
  const title = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(title).toBeFocused();
  await page.keyboard.type("Thoughts");
  await page.keyboard.press("Enter");
  await expect(page.locator("#note-title")).toHaveText("Thoughts");
  await expect.poll(() => fileText(page, "Projects/Thoughts.md")).toContain("# Ideas");
});

test("a command's shortcut changes, and the vault keeps it", async ({ page }) => {
  await openSample(page);
  await page.keyboard.press("Control+p");
  await page.getByRole("combobox", { name: "Command" }).fill("keyboard");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });

  // A key alone would run while typing, so it is refused.
  const change = dialog.getByRole("button", { name: "Change the shortcut of Search the vault" });
  await change.click();
  await expect(change).toHaveText("Press keys…");
  await page.keyboard.press("k");
  await expect(dialog.getByRole("status")).toContainText("K would run while typing");

  // Ctrl+O moves from the quick switcher to search.
  await page.keyboard.press("Control+o");
  await expect(dialog.getByRole("status")).toHaveText(
    "Ctrl+O was the shortcut of Open a note by its name, which now has none.",
  );
  const search = dialog.getByRole("row", { name: /Search the vault/ });
  await expect(search.locator("kbd")).toHaveText("Ctrl+O");
  await expect(dialog.getByRole("row", { name: /Open a note by its name/ })).toContainText("None");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => JSON.parse((await fileText(page, ".nether/hotkeys.json")) ?? "{}") as unknown)
    .toEqual({ search: ["Mod+O"], switcher: [] });

  await page.keyboard.press("Control+o");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Open a note" })).toHaveCount(0);
});
