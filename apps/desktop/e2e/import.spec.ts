// Importing: a folder of Markdown, as an Obsidian vault, brought over byte
// for byte into a folder of its own, and a CSV table made a database.
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

/** Gives the preview what the next import reads, as a folder or files the user chose. */
async function willImport(
  page: Page,
  name: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await page.evaluate(
    ([source, content]) => {
      (
        globalThis as unknown as {
          netherPreview: { imports: { name: string; files: Record<string, string> }[] };
        }
      ).netherPreview.imports.push({ name: source, files: content });
    },
    [name, files] as const,
  );
}

const vault = {
  "Home.md": "---\ntags: [start]\n---\n# Home\r\n\r\nSee [[Plan]] and ![[photo.png]].\r\n",
  "Projects/Plan.md": "The plan, ==marked==, with %%a comment%%.\n",
  "photo.png": "PNG",
};

test("an Obsidian vault imports byte for byte into a folder of its own, and again beside it", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await openSample(page);
  await willImport(page, "Old vault", vault);
  await page.keyboard.press("Control+p");
  await page.keyboard.type("import");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import" });
  await expect(
    dialog.getByRole("radio", { name: /An Obsidian vault, or a folder of Markdown/ }),
  ).toBeChecked();

  const results = await new AxeBuilder({ page })
    .include("[role=dialog]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await dialog.getByRole("button", { name: "Choose and import…" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Imported 2 notes and 1 other file into Old vault.",
  );
  expect(await fileText(page, "Old vault/Home.md")).toBe(vault["Home.md"]);
  expect(await fileText(page, "Old vault/Projects/Plan.md")).toBe(vault["Projects/Plan.md"]);
  expect(await fileText(page, "Old vault/photo.png")).toBeDefined();

  // Once more: beside the first, which stays as it was.
  await willImport(page, "Old vault", vault);
  await dialog.getByRole("button", { name: "Choose and import…" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Imported 2 notes and 1 other file into Old vault 2.",
  );
  expect(await fileText(page, "Old vault 2/Home.md")).toBe(vault["Home.md"]);

  await dialog.getByRole("button", { name: "Open Home" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#note-title")).toHaveText("Home");
  expect(errors).toEqual([]);
});

test("a CSV table imports as a database, a note for each line", async ({ page }) => {
  const errors = errorsOf(page);
  await openSample(page);
  await willImport(page, "Tasks", { "Tasks.csv": "Name,Points,Done\nWrite,3,yes\nRead,5,no\n" });
  await page.keyboard.press("Control+p");
  await page.keyboard.type("import");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import" });
  await dialog.getByRole("radio", { name: /CSV tables/ }).check();
  await dialog.getByRole("button", { name: "Choose and import…" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Imported 3 notes.");
  expect(await fileText(page, "Tasks/Write.md")).toBe("---\nPoints: 3\nDone: true\n---\n");

  await dialog.getByRole("button", { name: "Open Tasks" }).click();
  const database = page.getByRole("region", { name: "Database" });
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveText(["Read", "Write"]);
  await expect(database.getByLabel("Points of Write", { exact: true })).toHaveValue("3");
  expect(errors).toEqual([]);
});
