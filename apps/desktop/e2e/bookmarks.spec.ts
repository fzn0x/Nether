import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample, violations } from "./helpers.ts";

/** The vault's bookmarks file, as the app last wrote it. */
async function bookmarksFile(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const preview = (
      globalThis as unknown as {
        netherPreview: {
          files: { read(path: string): Promise<{ text: string; missing?: boolean }> };
        };
      }
    ).netherPreview;
    const read = await preview.files.read(".nether/bookmarks.json");
    return read.missing === true ? undefined : (JSON.parse(read.text) as unknown);
  });
}

test("notes are bookmarked from their menu and the palette, and the bookmarks follow them", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  const bookmarks = page.getByRole("region", { name: "Bookmarks" });
  await expect(bookmarks).toHaveCount(0);

  // From a note's menu.
  await notes.getByRole("button", { name: /Roadmap/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bookmark" }).click();
  await expect(bookmarks.getByRole("listitem")).toHaveText(["Roadmap×"]);

  // From the palette, for the open note.
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page.keyboard.press("Control+P");
  await page.getByRole("combobox", { name: "Command" }).fill("bookmark the note");
  await page.keyboard.press("Enter");
  await expect(bookmarks.getByRole("listitem")).toHaveText(["Roadmap×", "Welcome×"]);
  expect(await violations(page)).toEqual([]);
  const file = (await bookmarksFile(page)) as { items: { type: string; path: string }[] };
  expect(file.items.map(({ type, path }) => ({ type, path }))).toEqual([
    { type: "file", path: "Projects/Roadmap.md" },
    { type: "file", path: "Welcome.md" },
  ]);

  // A bookmark opens its note.
  await bookmarks.getByRole("button", { name: "Roadmap", exact: true }).click();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");

  // Renamed, the note keeps its bookmark.
  await notes.getByRole("button", { name: /Roadmap/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page
    .getByRole("dialog", { name: "Rename Roadmap" })
    .getByRole("textbox", { name: "Name" })
    .fill("Plan");
  await page.keyboard.press("Enter");
  await expect(bookmarks.getByRole("listitem")).toHaveText(["Plan×", "Welcome×"]);
  await expect
    .poll(async () => ((await bookmarksFile(page)) as { items: { path: string }[] }).items[0]?.path)
    .toBe("Projects/Plan.md");

  // Its menu says it is bookmarked, and takes the bookmark away.
  await bookmarks.getByRole("button", { name: "Welcome", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove bookmark" }).click();
  await expect(bookmarks.getByRole("listitem")).toHaveText(["Plan×"]);

  // Its × takes it away too, and the list goes with the last.
  await bookmarks.getByRole("button", { name: "Remove the bookmark of Plan" }).click();
  await expect(bookmarks).toHaveCount(0);
  expect(await bookmarksFile(page)).toEqual({ items: [] });
  expect(errors).toEqual([]);
});

test("the bookmarks close and open by their heading", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Ideas/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bookmark" }).click();
  const bookmarks = page.getByRole("region", { name: "Bookmarks" });
  const heading = bookmarks.getByRole("button", { name: /Bookmarks/ });
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  await heading.click();
  await expect(heading).toHaveAttribute("aria-expanded", "false");
  await expect(bookmarks.getByRole("listitem")).toHaveCount(0);
  await heading.click();
  await expect(bookmarks.getByRole("listitem")).toHaveText(["Ideas×"]);
});
