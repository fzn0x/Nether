// What the end-to-end tests share: opening the sample vault, catching the
// page's errors, and waiting for the editor to catch up with the caret.
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, Request } from "@playwright/test";

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

/** Opens the browser preview's sample vault and returns its list of notes, shown as a list. */
export async function openSample(page: Page): Promise<Locator> {
  await openSampleTree(page);
  await page.getByRole("button", { name: "List", exact: true }).click();
  return page.getByRole("list", { name: "Notes" });
}

/** Opens the browser preview's sample vault, its notes shown as a tree. */
export async function openSampleTree(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: "Open a folder" }).click();
  return page.getByRole("tree", { name: "Notes" });
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

/** The address of the server the end-to-end tests answer as. */
export const fakeServerUrl = "https://nether.test";

export type Handler = (request: Request) => readonly [number, unknown?];

/** The page's errors, without the browser's notes of the server's refusals the test asks for. */
export function pageErrors(errors: readonly string[]): string[] {
  return errors.filter((error) => !error.startsWith("Failed to load resource"));
}

/** Answers the page's requests to the test's server, as a server with CORS would. */
export async function fakeServer(page: Page, routes: Readonly<Record<string, Handler>>) {
  const sent: Request[] = [];
  await page.route(`${fakeServerUrl}/**`, async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "accept, authorization, content-type",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    sent.push(request);
    const handler = routes[`${request.method()} ${new URL(request.url()).pathname}`];
    const [status, body] = handler?.(request) ?? [404, { message: "Not found." }];
    await route.fulfill({ status, headers, ...(body === undefined ? {} : { json: body }) });
  });
  return sent;
}

/** What axe finds against WCAG 2.2 A and AA on the page as it is. */
export async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => `${node.target.join(" ")} ${node.failureSummary ?? ""}`).join(", ")})`,
  );
}
