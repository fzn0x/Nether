// A note's unlinked mentions: the notes that write its name without a link,
// listed beside it, and each made a link with one click.
import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { errorsOf, openSample } from "./helpers.ts";

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

/** Changes a file of the sample vault as another app, such as Obsidian, would. */
async function editFile(page: Page, path: string, text: string): Promise<void> {
  await page.evaluate(
    ([file, next]) => {
      const preview = (
        globalThis as unknown as {
          netherPreview: { files: { edit(path: string, text: string): void } };
        }
      ).netherPreview;
      preview.files.edit(file ?? "", next ?? "");
    },
    [path, text],
  );
}

test("a note lists the notes that mention it without a link, and links one in a click", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await editFile(page, "Notes.md", "The roadmap is long, and the plan longer.\n");
  await notes.getByRole("button", { name: /^Roadmap/ }).click();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");

  const panel = page.getByRole("complementary", { name: "About this note" });
  const toggle = panel.getByRole("button", { name: "Unlinked mentions" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // Its name and its alias, Plan, each where they are written.
  const mentions = panel.locator(".mention");
  await expect(mentions).toHaveText([
    "The roadmap is long, and the plan longer.Link",
    "The roadmap is long, and the plan longer.Link",
  ]);
  await expect(mentions.locator("mark")).toHaveText(["roadmap", "plan"]);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // One click links the mention, changing nothing else in its file.
  await panel.getByRole("button", { name: "Link this mention in Notes" }).first().click();
  await expect
    .poll(() => fileText(page, "Notes.md"))
    .toBe("The [[Roadmap|roadmap]] is long, and the plan longer.\n");
  await expect(mentions.locator("mark")).toHaveText(["plan"]);
  await panel.getByRole("button", { name: "Link this mention in Notes" }).click();
  await expect
    .poll(() => fileText(page, "Notes.md"))
    .toBe("The [[Roadmap|roadmap]] is long, and the [[Roadmap|plan]] longer.\n");
  await expect(
    panel.getByText("No other note mentions this one without linking it."),
  ).toBeVisible();
  // It links here now.
  await expect(
    panel.locator(".backlinks").first().getByRole("button", { name: "Notes" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
