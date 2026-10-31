// A synced block: a block of another note embedded by its ID, edited where
// it is embedded, written to its note, and shown again wherever it is.
import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample } from "./helpers.ts";

/** A file of the sample vault, as the app last wrote it. */
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

/** Changes a file of the sample vault as another app, such as Obsidian, would. */
async function editFile(page: Page, path: string, text: string): Promise<void> {
  await page.evaluate(
    ([file, next]) => {
      const preview = (
        globalThis as unknown as {
          netherPreview: { files: { edit(path: string, text: string): void } };
        }
      ).netherPreview;
      preview.files.edit(file ?? "", next ?? "");
    },
    [path, text],
  );
}

const board = "# Board\n\n![[Source#^shared]]\n\n![[Source#Source]]\n";

test("a block embedded by its ID edits in place, and its note and every embed show the edit", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await editFile(page, "Source.md", "# Source\n\nA shared line ^shared\n");
  await editFile(page, "Board.md", board);
  await notes.getByRole("button", { name: /^Board/ }).click();
  await expect(page.locator("#note-title")).toHaveText("Board");

  // The block by its ID is synced; the heading's section stays as it is shown.
  const synced = page.getByRole("textbox", { name: "Synced block from Source" });
  await expect(synced).toHaveText("A shared line");
  await expect(page.getByRole("textbox", { name: /^Synced block/ })).toHaveCount(1);
  const section = page.locator(".note-embed").nth(1);
  await expect(section).toContainText("A shared line");

  // Edited where it is embedded: written to its note, and the other embed follows.
  await synced.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and more");
  await expect
    .poll(() => fileText(page, "Source.md"))
    .toBe("# Source\n\nA shared line and more ^shared\n");
  await expect(section).toContainText("A shared line and more");
  expect(await fileText(page, "Board.md")).toBe(board);

  // Enter in the block breaks its line: the embed still holds one block.
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");
  await expect(synced.locator("p")).toHaveCount(1);
  await expect
    .poll(() => fileText(page, "Source.md"))
    .toMatch(/^# Source\n\nA shared line and more\\?\n\s*Second line \^shared\n$/);

  // Changed by another app: the block shows it, once it is not being edited.
  await page
    .getByRole("textbox", { name: "Board, note text" })
    .getByRole("heading", { name: "Board" })
    .click();
  await editFile(page, "Source.md", "# Source\n\nChanged elsewhere ^shared\n");
  await expect(synced).toHaveText("Changed elsewhere");
  await expect(section).toContainText("Changed elsewhere");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // Its note shows the block as the embed left it.
  await page.locator(".synced-block").getByRole("button", { name: "Source" }).click();
  await expect(page.locator("#note-title")).toHaveText("Source");
  await expect(page.getByRole("textbox", { name: "Source, note text" })).toContainText(
    "Changed elsewhere",
  );
  expect(errors).toEqual([]);
});
