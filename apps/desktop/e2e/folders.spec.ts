// Folders made in the app: from the sidebar's button, the File menu and a
// folder's menu, shown in the tree while empty, refused where the vault has
// the name, and deleted while empty. The sidebar's actions are icons, named
// by their tooltips.
import { expect, test } from "@playwright/test";
import { openSampleTree, violations } from "./helpers.ts";

test("a folder is made, shown while empty, and deleted", async ({ page }) => {
  const tree = await openSampleTree(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  const name = dialog.getByRole("textbox", { name: "Name" });
  // A name the vault has is refused before it is tried.
  await name.fill("daily");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The vault already has daily.");
  await name.fill(".hidden");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("alert")).toContainText("starts with a dot");
  expect(await violations(page)).toEqual([]);
  await name.fill("Inbox");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  const inbox = tree.getByRole("treeitem", { name: "Inbox" });
  await expect(inbox).toBeVisible();

  // A folder in it, from its menu.
  await inbox.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Inbox: folder actions" });
  await menu.getByRole("menuitem", { name: "New folder here" }).click();
  await expect(dialog.getByText("Name, in Inbox")).toBeVisible();
  await name.fill("Later");
  await dialog.getByRole("button", { name: "Create" }).click();
  await inbox.click();
  const later = tree.getByRole("treeitem", { name: "Later" });
  await expect(later).toBeVisible();

  // Inbox holds a folder, so only Later can be deleted.
  await inbox.click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Delete folder" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await later.click({ button: "right" });
  await page
    .getByRole("menu", { name: "Inbox/Later: folder actions" })
    .getByRole("menuitem", { name: "Delete folder" })
    .click();
  await expect(later).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "Deleted the folder Later." }),
  ).toBeVisible();
});

test("a new note goes in a folder from its menu, and the File menu makes folders", async ({
  page,
}) => {
  const tree = await openSampleTree(page);
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Ideas/Big");
  await dialog.getByRole("button", { name: "Create" }).click();
  const ideas = tree.getByRole("treeitem", { name: "Ideas" });
  await ideas.click();
  await expect(tree.getByRole("treeitem", { name: "Big" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "New note here" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Ideas/Big/");
});

test("the sidebar's icons are named, with a tooltip on hover and focus", async ({ page }) => {
  await openSampleTree(page);
  const newNote = page.getByRole("button", { name: "New note", exact: true });
  await newNote.hover();
  await expect(page.locator(".tooltip")).toHaveText(/^New note/);
  await page.mouse.move(600, 400);
  await expect(page.locator(".tooltip")).toBeHidden();
  await newNote.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".tooltip")).toHaveText(/^New folder/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".tooltip")).toBeHidden();
});

test("a vault with folders and no notes shows its folders, and a new one at once", async ({
  page,
}) => {
  await openSampleTree(page);
  // Every file gone, as from another app: the vault has no notes.
  await page.evaluate(async () => {
    const files = (
      globalThis as unknown as {
        netherPreview: {
          files: {
            list(folder: string, each: (files: readonly { path: string }[]) => void): Promise<void>;
            edit(path: string, text: string | undefined): void;
          };
        };
      }
    ).netherPreview.files;
    const paths: string[] = [];
    await files.list("", (batch) => {
      for (const file of batch) paths.push(file.path);
    });
    for (const path of paths) files.edit(path, undefined);
  });
  // Its folders stay, as on disk, and show without a note in them.
  const tree = page.getByRole("tree", { name: "Notes" });
  await expect(tree.getByRole("treeitem", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("This vault has no notes yet.")).toBeHidden();
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("First");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByRole("tree", { name: "Notes" }).getByRole("treeitem", { name: "First" }),
  ).toBeVisible();
  await expect(page.getByText("This vault has no notes yet.")).toBeHidden();
});
