import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample, settle } from "./helpers.ts";

// Friday, 6 November 2026, where the browser is: not a day the sample has a note for.
const friday = new Date(2026, 10, 6, 9, 30);

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

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(friday);
});

test("a new note starts from a template, with the cursor where it says", async ({ page }) => {
  const errors = errorsOf(page);
  await openSample(page);
  await page.keyboard.press("Control+n");
  const dialog = page.getByRole("dialog", { name: "New note" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Kickoff");
  // The templates folder's notes are listed; typing finds any other.
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await dialog.getByRole("radio", { name: /Meeting/ }).check();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator("#note-title")).toHaveText("Kickoff");
  const editor = page.getByRole("textbox", { name: "Kickoff, note text" });
  await expect(editor).toBeFocused();
  await settle(page);
  await page.keyboard.type("Scope");
  await expect
    .poll(() => fileText(page, "Kickoff.md"))
    .toBe('---\ncreated: "2026-11-06"\n---\n\n# Kickoff\n\n## Agenda\n\n- Scope\n\n## Notes\n');
  await expect(page.getByText("7 notes")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a new note's name is checked, and any note can be its template", async ({ page }) => {
  await openSample(page);
  await page.getByRole("button", { name: "New note" }).click();
  const dialog = page.getByRole("dialog", { name: "New note" });
  const name = dialog.getByRole("textbox", { name: "Name" });
  await name.fill("welcome");
  await name.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("A note is already at welcome.md.");
  await name.fill("Ideas: more");
  await name.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("cannot start with a dot");

  // A note outside the templates folder, found by typing.
  await dialog.getByRole("searchbox", { name: "Find a note to start from" }).fill("roadmap");
  await dialog.getByRole("radio", { name: /Roadmap/ }).check();
  await name.fill("Projects/Next year");
  await name.press("Enter");
  await expect(page.locator("#note-title")).toHaveText("Next year");
  const roadmap = await fileText(page, "Projects/Roadmap.md");
  await expect.poll(() => fileText(page, "Projects/Next year.md")).toBe(roadmap);

  // With no name, an untitled blank note.
  await page.getByRole("button", { name: "New note" }).click();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#note-title")).toHaveText("Untitled");
  expect(await fileText(page, "Untitled.md")).toBe("");
});

test("today's note opens from its template, and is the same note the next time", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  // The sample keeps Obsidian's settings: daily notes go in Daily, from Templates/Daily.
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.locator("#note-title")).toHaveText("2026-11-06");
  const editor = page.getByRole("textbox", { name: "2026-11-06, note text" });
  await expect(editor).toBeFocused();
  await settle(page);
  await page.keyboard.type("Plans");
  await expect
    .poll(() => fileText(page, "Daily/2026-11-06.md"))
    .toBe(
      "---\ntags: [daily]\n---\n\n# Friday, 6 November\n\nPlans\n\n[[2026-11-05]] · [[2026-11-07]]\n",
    );

  await notes.getByRole("button", { name: /Welcome/ }).click();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.locator("#note-title")).toHaveText("2026-11-06");
  await expect(page.getByText("7 notes")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the settings turn on weekly notes, and the vault keeps them", async ({ page }) => {
  await openSample(page);
  await expect(page.getByRole("button", { name: "This week" })).toBeHidden();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("menuitem", { name: /^Templates and periodic notes/ }).click();
  const dialog = page.getByRole("dialog", { name: "Templates and periodic notes" });
  // Obsidian's settings for daily notes show, until Nether's own are saved.
  const daily = dialog.getByRole("group", { name: "Daily notes" });
  await expect(daily.getByRole("textbox", { name: "Folder" })).toHaveValue("Daily");
  const weekly = dialog.getByRole("group", { name: "Weekly notes" });
  await weekly.getByRole("checkbox", { name: "Show its button" }).check();
  await weekly.getByRole("textbox", { name: "Folder" }).fill("Weeks");
  await expect(weekly.getByText("Now: Weeks/2026-W45.md")).toBeVisible();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "This week" }).click();
  await expect(page.locator("#note-title")).toHaveText("2026-W45");
  await expect.poll(() => fileText(page, "Weeks/2026-W45.md")).toBe("");
  const saved = JSON.parse((await fileText(page, ".nether/templates.json")) ?? "{}") as {
    day: { folder: string; template: string };
    week: { enabled: boolean; folder: string };
  };
  expect(saved.day).toMatchObject({ folder: "Daily", template: "Templates/Daily" });
  expect(saved.week).toMatchObject({ enabled: true, folder: "Weeks" });
});
