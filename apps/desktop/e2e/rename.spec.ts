import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample, settle } from "./helpers.ts";

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

test("a note renamed in place keeps every link to it working", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  const roadmap = await fileText(page, "Projects/Roadmap.md");
  await notes.getByRole("button", { name: /Roadmap/ }).click();
  const title = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(title).toHaveText("Roadmap");
  await title.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Plan of record");
  await page.keyboard.press("Enter");

  await expect(page.locator("#note-title")).toHaveText("Plan of record");
  await expect(notes.getByRole("button", { name: /Plan of record/ })).toBeVisible();
  await expect.poll(() => fileText(page, "Projects/Plan of record.md")).toBe(roadmap);
  expect(await fileText(page, "Projects/Roadmap.md")).toBeUndefined();
  // Welcome linked to it by its path, and still does.
  await expect
    .poll(() => fileText(page, "Welcome.md"))
    .toContain("[[Projects/Plan of record|the roadmap]]");

  // The link leads to it.
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page.getByRole("textbox", { name: "Welcome, note text" }).getByText("the roadmap").click();
  await expect(page.locator("#note-title")).toHaveText("Plan of record");
  expect(errors).toEqual([]);
});

test("a name a note cannot have is refused, and Escape keeps the name", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Ideas/ }).click();
  const title = page.getByRole("textbox", { name: "Name", exact: true });
  await title.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Ideas: more");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("cannot start with a dot");
  await expect(title).toHaveText("Ideas");

  await title.click();
  await settle(page);
  await page.keyboard.press("End");
  await page.keyboard.type(" later");
  await page.keyboard.press("Escape");
  await expect(title).toHaveText("Ideas");
  expect(await fileText(page, "Projects/Ideas.md")).toContain("# Ideas");
});
