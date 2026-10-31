// Canvases (ADR 0051): a `.canvas` file in the tree opens in a tab beside
// notes, its cards in reading order and its connections in words; it zooms,
// fits and follows the file as another app changes it; a new one is made
// from the File menu, and goes to the trash and back.
import { type Page, expect, test } from "@playwright/test";
import { openSampleTree, violations } from "./helpers.ts";

const board = `{
	"nodes":[
		{"id":"g000000000000001","type":"group","label":"Launch","x":-420,"y":-260,"width":760,"height":460},
		{"id":"t000000000000002","type":"text","text":"Invite ten teams","x":-380,"y":20,"width":260,"height":70},
		{"id":"t000000000000001","type":"text","text":"Ship the beta","x":-380,"y":-220,"width":260,"height":140,"color":"2"},
		{"id":"f000000000000001","type":"file","file":"Projects/Roadmap.md","x":20,"y":-220,"width":280,"height":80}
	],
	"edges":[
		{"id":"e000000000000001","fromNode":"t000000000000001","toNode":"f000000000000001","label":"plan"}
	]
}`;

/** Writes a file of the sample vault as another app would. */
async function edit(page: Page, path: string, text: string | undefined): Promise<void> {
  await page.evaluate(
    ([file, next]) => {
      (
        globalThis as unknown as {
          netherPreview: { files: { edit(path: string, text: string | undefined): void } };
        }
      ).netherPreview.files.edit(file, next);
    },
    [path, text] as const,
  );
}

test("a canvas opens in a tab, its cards in reading order, zooms and follows its file", async ({
  page,
}) => {
  const tree = await openSampleTree(page);
  await edit(page, "Projects/Board.canvas", board);
  await tree.getByRole("treeitem", { name: "Projects" }).click();
  await tree.getByRole("treeitem", { name: /^Board/ }).click();
  await expect(page.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Board", level: 1 })).toBeVisible();

  const cards = page.getByRole("list", { name: "Board: cards" }).getByRole("listitem");
  // Top to bottom, then along each row: the group first, as it starts highest.
  await expect(cards).toHaveText(["Launch", "Ship the beta", "Roadmap", "Invite ten teams"]);
  await expect(page.getByRole("list", { name: "Connections" })).toHaveText(
    "From Ship the beta to Roadmap: plan",
  );
  expect(await violations(page)).toEqual([]);

  const level = page.locator(".canvas-zoom-level");
  await expect(level).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(level).toHaveText("80%");
  await page.getByRole("button", { name: "Fit to view" }).click();
  await expect(level).toHaveText("100%");

  // Changed by another app, it shows the change.
  await edit(
    page,
    "Projects/Board.canvas",
    board.replace("Invite ten teams", "Invite twenty teams"),
  );
  await expect(cards.last()).toHaveText("Invite twenty teams");

  // A note's card opens the note.
  await page.getByRole("button", { name: "Roadmap" }).click();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
});

test("a new canvas is made from the File menu, and goes to the trash and back", async ({
  page,
}) => {
  const tree = await openSampleTree(page);
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /^New canvas/ }).click();
  await expect(page.getByRole("tab", { name: "Untitled canvas" })).toBeVisible();
  await expect(page.getByText("This canvas is empty.")).toBeVisible();
  const made = tree.getByRole("treeitem", { name: /^Untitled canvas/ });
  await expect(made).toBeVisible();

  await made.click({ button: "right" });
  await page
    .getByRole("menu", { name: "Untitled canvas.canvas: canvas actions" })
    .getByRole("menuitem", { name: "Move to trash" })
    .click();
  await expect(made).toBeHidden();
  await expect(page.getByRole("tab", { name: "Untitled canvas" })).toBeHidden();
  await page.getByRole("status").getByRole("button", { name: "Restore" }).click();
  await expect(made).toBeVisible();

  // A file that is not a canvas says so, rather than drawing nothing.
  await edit(page, "Broken.canvas", "{ not json");
  await tree.getByRole("treeitem", { name: /^Broken/ }).click();
  await expect(page.getByRole("alert")).toHaveText("The canvas file is not JSON.");
});
