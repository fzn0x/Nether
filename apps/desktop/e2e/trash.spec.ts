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

test("a note moved to the trash comes back as it was", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  const welcome = await fileText(page, "Welcome.md");
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page.getByRole("button", { name: "Move to trash" }).click();
  const notice = page.getByRole("status").filter({ hasText: "Welcome is in the trash." });
  await expect(notice).toBeVisible();
  await expect(notes.getByRole("button", { name: /Welcome/ })).toHaveCount(0);
  await expect(page.getByText("5 notes")).toBeVisible();
  expect(await fileText(page, ".trash/Welcome.md")).toBe(welcome);

  await notice.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator("#note-title")).toHaveText("Welcome");
  await expect(page.getByText("6 notes")).toBeVisible();
  expect(await fileText(page, "Welcome.md")).toBe(welcome);
  expect(await fileText(page, ".trash/Welcome.md")).toBeUndefined();
  expect(errors).toEqual([]);
});

test("the trash lists removed notes, restores them, and deletes them for good", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  for (const title of ["Roadmap", "Ideas"]) {
    await notes.getByRole("button", { name: new RegExp(title) }).click();
    await page.getByRole("button", { name: "Move to trash" }).click();
    await expect(notes.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  const trash = page.getByRole("region", { name: "Trash" });
  const items = trash.getByRole("listitem");
  // The latest first, each with where it was and how long it stays.
  await expect(items.locator(".note-title")).toHaveText(["Ideas", "Roadmap"]);
  await expect(items.locator(".note-folder")).toHaveText(["Projects", "Projects"]);
  await expect(items.first().locator(".trash-when")).toHaveText("Deleted today, 30 days left");

  await trash.getByRole("button", { name: "Restore Roadmap" }).click();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
  await expect(items.locator(".note-title")).toHaveText(["Ideas"]);

  await trash.getByRole("button", { name: "Delete Ideas for good" }).click();
  const confirm = trash.getByRole("group", { name: "Delete Ideas for good?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await trash.getByRole("button", { name: "Delete Ideas for good" }).click();
  await confirm.getByRole("button", { name: "Delete for good" }).click();
  await expect(trash.getByText("The trash is empty.")).toBeVisible();
  expect(await fileText(page, ".trash/Ideas.md")).toBeUndefined();
  expect(await fileText(page, "Projects/Roadmap.md")).toContain("# Roadmap");
  expect(errors).toEqual([]);
});

test("the trash keeps notes as many days as it is set to, and empties at once", async ({
  page,
}) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page.getByRole("button", { name: "Move to trash" }).click();
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await page.getByRole("button", { name: "Move to trash" }).click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  const trash = page.getByRole("region", { name: "Trash" });

  const days = trash.getByRole("spinbutton", { name: /Keep notes in the trash for/ });
  await expect(days).toHaveValue("30");
  await days.fill("7");
  await days.press("Enter");
  await expect(trash.locator(".trash-when").first()).toHaveText("Deleted today, 7 days left");
  await expect
    .poll(
      async () =>
        (
          JSON.parse((await fileText(page, ".nether/trash.json")) ?? "{}") as {
            keepDays?: number;
          }
        ).keepDays,
    )
    .toBe(7);

  await trash.getByRole("button", { name: "Empty trash" }).click();
  await trash
    .getByRole("group", { name: "Delete all 2 for good?" })
    .getByRole("button", { name: "Empty trash" })
    .click();
  await expect(trash.getByText("The trash is empty.")).toBeVisible();
  expect(await fileText(page, ".trash/Welcome.md")).toBeUndefined();
});

test("a notice in the sidebar closes with its ×", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page.getByRole("button", { name: "Move to trash" }).click();
  const notice = page.getByRole("status").filter({ hasText: "Welcome is in the trash." });
  await expect(notice).toBeVisible();

  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  expect(errors).toEqual([]);
});
