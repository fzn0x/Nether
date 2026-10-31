// Every screen and dialog, checked against WCAG 2.2 A and AA with axe, in
// the light theme and the dark one: the checks a machine can make, such as
// names, roles, contrast and focus order. Screen readers and keyboards are
// still tried by hand. And the layout from right to left, as Arabic and
// Hebrew need it.
import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { openNote, openSample, openSampleTree, settle } from "./helpers.ts";

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`,
  );
}

test("the layout mirrors from right to left, and text reads in its own direction", async ({
  page,
}) => {
  const tree = await openSampleTree(page);
  // As the interface does in a language written right to left.
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  const sidebar = await page.locator(".sidebar").boundingBox();
  const pane = await page.locator(".pane").boundingBox();
  expect(sidebar !== null && pane !== null && sidebar.x > pane.x).toBe(true);

  // The tree opens towards the left: Right goes up to a folder and closes it.
  const projects = tree.getByRole("treeitem", { name: /Projects/ });
  await projects.click();
  await tree.getByRole("treeitem", { name: /Ideas/ }).click();
  // Once the note it opens shows, which renders the tree again.
  await expect(page.locator("#note-title")).toHaveText("Ideas");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(projects).toHaveAttribute("aria-expanded", "false");
  await expect(projects).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(projects).toHaveAttribute("aria-expanded", "true");

  // A paragraph in Hebrew starts at the right, one in English at the left.
  await tree.getByRole("treeitem", { name: /Welcome/ }).click();
  const editor = page.getByRole("textbox", { name: "Welcome, note text" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await settle(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("שלום עולם");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Hello world");
  const edges = await editor.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const text = (content: string) => {
      const paragraph = [...element.querySelectorAll("p")].find((p) => p.textContent === content);
      if (paragraph === undefined) return undefined;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const rect = range.getBoundingClientRect();
      return { left: rect.left - box.left, right: box.right - rect.right };
    };
    return { hebrew: text("שלום עולם"), english: text("Hello world") };
  });
  expect(edges.hebrew !== undefined && edges.hebrew.right < edges.hebrew.left).toBe(true);
  expect(edges.english !== undefined && edges.english.left < edges.english.right).toBe(true);
  expect(await violations(page)).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("the welcome screen", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Open a folder" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("a vault, its folders and a note with every kind of block", async ({ page }) => {
      await openSampleTree(page);
      await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      const editor = await openNote(page, "Roadmap");
      await expect(editor.locator(".callout-title")).toBeVisible();
      expect(await violations(page)).toEqual([]);
      // Tags and links show as chips.
      const welcome = await openNote(page, "Welcome");
      await expect(welcome.locator(".chip").first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the tags, search and trash panels", async ({ page }) => {
      await openSample(page);
      await page.getByRole("button", { name: "Tags" }).click();
      await expect(page.getByRole("list", { name: "Tags" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole("button", { name: "Search" }).click();
      await page.getByRole("searchbox").fill("notes");
      await expect(page.getByRole("list", { name: "Notes found" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole("button", { name: "Trash", exact: true }).click();
      expect(await violations(page)).toEqual([]);
    });

    test("source mode", async ({ page }) => {
      await openNote(page, "Welcome");
      await page.keyboard.press("ControlOrMeta+/");
      await expect(page.locator(".cm-content")).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the dialogs", async ({ page }) => {
      await openNote(page, "Ideas");
      const dialogs: [string, () => Promise<void>][] = [
        ["Command palette", () => page.keyboard.press("Control+p")],
        ["Open a note", () => page.keyboard.press("Control+o")],
        ["New note", () => page.getByRole("button", { name: "New note" }).click()],
        [
          "Templates and periodic notes",
          () => page.getByRole("button", { name: "Settings" }).click(),
        ],
        ["Export", () => page.getByRole("button", { name: "Export", exact: true }).click()],
      ];
      for (const [name, open] of dialogs) {
        await open();
        await expect(page.getByRole("dialog", { name })).toBeVisible();
        expect(await violations(page), name).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name })).toHaveCount(0);
      }
      await page.keyboard.press("Control+p");
      await page.keyboard.type("keyboard shortcuts");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
      expect(await violations(page), "Keyboard shortcuts").toEqual([]);
    });
  });
}
