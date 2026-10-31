import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSampleTree } from "./helpers.ts";

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

test("the file tree shows folders and their notes, opened by click or key", async ({ page }) => {
  const errors = errorsOf(page);
  const tree = await openSampleTree(page);
  const rows = tree.getByRole("treeitem");
  // Folders first, closed, the one with only images too, then the notes at the top.
  await expect(rows).toHaveText(
    ["attachments", "Daily", "Projects", "Templates", "Welcome+"].map((name) => new RegExp(name)),
  );
  const projects = tree.getByRole("treeitem", { name: /Projects/ });
  await expect(projects).toHaveAttribute("aria-expanded", "false");
  await projects.click();
  await expect(projects).toHaveAttribute("aria-expanded", "true");
  await expect(tree.getByRole("treeitem", { name: /Roadmap/ })).toHaveAttribute("aria-level", "2");

  // The arrow keys: down to Ideas, Enter opens it; left goes back to the folder and closes it.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#note-title")).toHaveText("Ideas");
  const ideas = tree.getByRole("treeitem", { name: /Ideas/ });
  await expect(ideas).toHaveAttribute("aria-selected", "true");
  await ideas.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(projects).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(projects).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("the page tree puts the notes of the folder beside a note under it", async ({ page }) => {
  const tree = await openSampleTree(page);
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  // Daily.md is not in the sample: Daily stays a folder; Templates too.
  await expect(tree.getByRole("treeitem", { name: /Daily/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // A page made inside Welcome puts Welcome's pages in a Welcome folder.
  await tree.getByRole("treeitem", { name: /Welcome/ }).hover();
  await tree.getByRole("button", { name: "New note in Welcome" }).click();
  const dialog = page.getByRole("dialog", { name: "New note" });
  const name = dialog.getByRole("textbox", { name: "Name" });
  await expect(name).toHaveValue("Welcome/");
  await name.press("End");
  await name.pressSequentially("Getting started");
  await name.press("Enter");
  await expect(page.locator("#note-title")).toHaveText("Getting started");
  expect(await fileText(page, "Welcome/Getting started.md")).toBe("");
  const welcome = tree.getByRole("treeitem", { name: /^Welcome/ });
  await expect(welcome).toHaveAttribute("aria-expanded", "true");
  await expect(tree.getByRole("treeitem", { name: /Getting started/ })).toHaveAttribute(
    "aria-level",
    "2",
  );

  // In the file tree, the same notes are a folder and a note.
  await page.getByRole("button", { name: "Folders", exact: true }).click();
  await expect(tree.getByRole("treeitem", { name: /^Welcome/ })).toHaveCount(2);
});

test("a page dragged onto another moves under it, with its pages and links", async ({ page }) => {
  const errors = errorsOf(page);
  const tree = await openSampleTree(page);
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await tree.getByRole("treeitem", { name: /Projects/ }).click();
  const welcome = await fileText(page, "Welcome.md");

  // Roadmap onto Welcome: it becomes Welcome's page, and Welcome's link to it follows.
  await tree
    .getByRole("treeitem", { name: /Roadmap/ })
    .dragTo(tree.getByRole("treeitem", { name: /^Welcome/ }));
  await expect.poll(() => fileText(page, "Welcome/Roadmap.md")).toContain("# Roadmap");
  expect(await fileText(page, "Projects/Roadmap.md")).toBeUndefined();
  await expect
    .poll(() => fileText(page, "Welcome.md"))
    .toBe(welcome?.replace("[[Projects/Roadmap|the roadmap]]", "[[Welcome/Roadmap|the roadmap]]"));
  await expect(tree.getByRole("treeitem", { name: /^Welcome/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(errors).toEqual([]);
});

test("a folder dragged onto another moves into it with all it holds", async ({ page }) => {
  const tree = await openSampleTree(page);
  await tree
    .getByRole("treeitem", { name: /Templates/ })
    .dragTo(tree.getByRole("treeitem", { name: /Projects/ }));
  await expect.poll(() => fileText(page, "Projects/Templates/Daily.md")).toContain("{{cursor}}");
  expect(await fileText(page, "Templates/Meeting.md")).toBeUndefined();
  const projects = tree.getByRole("treeitem", { name: /Projects/ });
  await projects.click();
  await expect(tree.getByRole("treeitem", { name: /Templates/ })).toHaveAttribute(
    "aria-level",
    "2",
  );
});
