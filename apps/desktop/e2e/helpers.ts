// What the end-to-end tests share: opening the sample vault, catching the
// page's errors, and waiting for the editor to catch up with the caret.
import type { Locator, Page } from "@playwright/test";

/** Collects what the page writes to the console as errors, and what it throws. */
export function errorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/**
 * Waits for the editor to see where the caret is. A click or a key such as
 * End moves the browser's caret, and the editor reads it when the browser
 * reports the change, a frame later: keys pressed sooner act where it was.
 */
export async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

/** Opens the browser preview's sample vault and returns its list of notes. */
export async function openSample(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: "Open a folder" }).click();
  return page.getByRole("list", { name: "Notes" });
}

/** Opens a note of the sample vault and returns its editor. */
export async function openNote(page: Page, title: string): Promise<Locator> {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: new RegExp(title) }).click();
  return page.getByRole("textbox", { name: `${title}, note text` });
}

/** Puts the caret at the end of the editor's first paragraph. */
export async function endOfFirstParagraph(page: Page, editor: Locator) {
  const paragraph = editor.locator("p").first();
  const box = await paragraph.boundingBox();
  if (box === null) throw new Error("the paragraph is not on the page");
  // Past the end of its last line, which may wrap, and so past any math in it.
  await paragraph.click({ position: { x: box.width - 2, y: box.height - 4 } });
  await settle(page);
  await page.keyboard.press("End");
  await settle(page);
}
