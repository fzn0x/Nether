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
  await page.getByRole("button", { name: "Roadmap", exact: true }).click();
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

/** A file of the sample vault, as the app last wrote it. */
async function fileText(page: Page, path: string): Promise<string> {
  return page.evaluate(async (file) => {
    const read = await (
      globalThis as unknown as {
        netherPreview: { files: { read(path: string): Promise<{ text: string }> } };
      }
    ).netherPreview.files.read(file);
    return read.text;
  }, path);
}

/** The canvas the app last wrote, as JSON. */
async function written(page: Page, path: string) {
  return JSON.parse(await fileText(page, path)) as {
    nodes: { id: string; type: string; text?: string; file?: string; x: number; width: number }[];
    edges: { fromNode: string; toNode: string; label?: string }[];
  };
}

test("cards are written, moved, connected, labelled and removed, and undone", async ({ page }) => {
  const tree = await openSampleTree(page);
  await edit(page, "Projects/Board.canvas", board);
  await tree.getByRole("treeitem", { name: "Projects" }).click();
  await tree.getByRole("treeitem", { name: /^Board/ }).click();
  const cards = page.getByRole("list", { name: "Board: cards" });

  // A double click on the board makes a text card to write in.
  const pane = page.locator(".canvas-pane");
  const box = await pane.boundingBox();
  if (box === null) throw new Error("The board has no box.");
  await page.mouse.dblclick(box.x + box.width - 60, box.y + box.height - 60);
  const editor = page.getByRole("textbox", { name: "Card text" });
  await expect(editor).toBeFocused();
  await editor.fill("Hello");
  await page.keyboard.press("Escape");
  const hello = cards.getByRole("listitem", { name: "Text: Hello" });
  await expect(hello).toBeFocused();
  await expect
    .poll(async () => (await written(page, "Projects/Board.canvas")).nodes.map((node) => node.text))
    .toContain("Hello");
  const helloOf = async () =>
    (await written(page, "Projects/Board.canvas")).nodes.find((node) => node.text === "Hello");
  const startX = (await helloOf())?.x ?? 0;

  // The arrow keys move it, and with Alt, resize it.
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await helloOf())?.x).toBe(startX + 20);
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(async () => (await helloOf())?.width).toBe(270);

  // Its menu connects it to another card.
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Connect to…" }).click();
  await page
    .getByRole("menu", { name: "Connect to" })
    .getByRole("menuitem", { name: "Roadmap" })
    .click();
  const connections = page.getByRole("list", { name: "Connections" });
  await expect(connections).toContainText("From Hello to Roadmap");
  expect(await violations(page)).toEqual([]);

  // Undone and done again.
  await hello.focus();
  await page.keyboard.press("Control+z");
  await expect(connections).not.toContainText("From Hello to Roadmap");
  await page.keyboard.press("Control+Shift+z");
  await expect(connections).toContainText("From Hello to Roadmap");

  // The arrow is labelled from the connections list, which the keyboard reaches.
  await connections.getByRole("button", { name: "From Hello to Roadmap" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Label the arrow" }).click();
  const dialog = page.getByRole("dialog", { name: "Label the arrow" });
  await dialog.getByRole("textbox", { name: "Label" }).fill("next");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(connections).toContainText("From Hello to Roadmap: next");
  await expect
    .poll(async () =>
      (await written(page, "Projects/Board.canvas")).edges.map((edge) => edge.label),
    )
    .toContain("next");

  // A note added from the toolbar.
  await page.getByRole("button", { name: "Add a note" }).click();
  await page.getByRole("dialog", { name: "Add a note" }).getByRole("combobox").fill("Ideas");
  await page.keyboard.press("Enter");
  await expect(cards.getByRole("listitem", { name: "Note or file: Ideas" })).toBeVisible();

  // Removed, with its arrows.
  await hello.focus();
  await page.keyboard.press("Delete");
  await expect(hello).toBeHidden();
  await expect(connections).not.toContainText("Hello");
  await expect
    .poll(async () =>
      (await written(page, "Projects/Board.canvas")).nodes.some((node) => node.text === "Hello"),
    )
    .toBe(false);
});

test("a canvas with parts it could not read is not changed", async ({ page }) => {
  const tree = await openSampleTree(page);
  await edit(
    page,
    "Odd.canvas",
    '{"nodes":[{"id":"x","type":"shape","x":0,"y":0,"width":9,"height":9}],"edges":[]}',
  );
  await tree.getByRole("treeitem", { name: /^Odd/ }).click();
  await expect(page.getByText("1 things in this canvas's file could not be read")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add text" })).toBeHidden();
});
