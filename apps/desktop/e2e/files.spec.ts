import { expect, test } from "@playwright/test";
import { endOfFirstParagraph, errorsOf, openNote, openSample } from "./helpers.ts";

// A PNG of one transparent pixel.
const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("an embedded image loads from the vault at its size", async ({ page }) => {
  const errors = errorsOf(page);
  const editor = await openNote(page, "Roadmap");
  const image = editor.locator(".image-block img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("width", "240");
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(
    0,
  );
  expect(errors).toEqual([]);
});

test("an image block finds a file by its link, and says when it cannot", async ({ page }) => {
  const editor = await openNote(page, "Welcome");
  const add = async (link: string) => {
    await endOfFirstParagraph(page, editor);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/image");
    await page.keyboard.press("Enter");
    const field = page.getByRole("textbox", { name: "Path or URL of the file" });
    await expect(field).toBeFocused();
    await page.keyboard.type(link);
    await page.keyboard.press("Enter");
    await expect(field).toBeHidden();
  };
  await add("missing.png");
  await expect(editor.getByRole("note")).toHaveText("Not in the vault: missing.png");
  await add("attachments/diagram.png");
  await expect(editor.getByRole("note").first()).toHaveText(
    "Cannot be shown: attachments/diagram.png",
  );
  // By its name alone, as Obsidian finds files.
  await add("sketch.svg");
  await expect(editor.locator(".image-block img")).toBeVisible();
});

test("a pasted image goes in the attachments folder and stays in the note", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await endOfFirstParagraph(page, editor);
  await editor.evaluate((element, data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    // Browsers name every pasted image so.
    transfer.items.add(new File([bytes], "image.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, pixel);
  await expect(editor.locator(".image-block img")).toBeVisible();
  // An attachment is not a note, and the note keeps its embed.
  await expect(page.getByText("4 notes")).toBeVisible();
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Welcome, note text" }).locator(".image-block img"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
