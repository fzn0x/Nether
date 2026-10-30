import { type Page, expect, test } from "@playwright/test";
import { endOfFirstParagraph, errorsOf, openSample, settle } from "./helpers.ts";

/** Changes a file of the browser preview's vault as another app would. */
async function editAsAnotherApp(page: Page, path: string, change: (text: string) => string) {
  const text = await page.evaluate(async (file) => {
    const preview = (
      globalThis as unknown as {
        netherPreview: { files: { read(path: string): Promise<{ text: string }> } };
      }
    ).netherPreview;
    return (await preview.files.read(file)).text;
  }, path);
  await page.evaluate(
    ([file, next]) => {
      const preview = (
        globalThis as unknown as {
          netherPreview: { files: { edit(path: string, text: string): void } };
        }
      ).netherPreview;
      preview.files.edit(file ?? "", next ?? "");
    },
    [path, change(text)],
  );
}

test("another app's edit to an open note merges with what is typed meanwhile", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await endOfFirstParagraph(page, editor);
  await page.keyboard.type(" Typed in Nether.");
  // Before Nether saves, another app adds a paragraph to the file.
  await editAsAnotherApp(page, "Welcome.md", (text) => `${text}\nAdded by another app.\n`);
  await expect(editor.getByText("Added by another app.")).toBeVisible();
  await expect(editor.locator("p").first()).toContainText("Typed in Nether.");

  // Both are in the file.
  await settle(page);
  await page.getByRole("button", { name: "Markdown source" }).click();
  const source = page.getByRole("textbox", { name: "Welcome, Markdown source" });
  await expect(source).toContainText("Typed in Nether.");
  await expect(source).toContainText("Added by another app.");
  expect(errors).toEqual([]);
});

test("another app's edit while the note is closed shows when it opens", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await editAsAnotherApp(page, "Projects/Ideas.md", (text) =>
    text.replace("# Ideas", "# Ideas, renamed elsewhere"),
  );
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Ideas, note text" }).getByRole("heading", { level: 1 }),
  ).toHaveText("Ideas, renamed elsewhere");
});
