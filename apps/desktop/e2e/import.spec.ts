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

test("a Notion export imports as pages and databases, its links made wiki links", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await openSample(page);
  const id = (digit: string) => digit.repeat(32);
  await willImport(page, `Export-${id("0")}`, {
    [`Home ${id("1")}.md`]: `# Home\n\nSee [Tasks](Tasks%20${id("2")}.csv) and [Write](Tasks%20${id("2")}/Write%20${id("3")}.md).\n`,
    [`Tasks ${id("2")}.csv`]: 'Name,Status,Due\nWrite,Doing,"October 30, 2026"\n',
    [`Tasks ${id("2")}/Write ${id("3")}.md`]:
      "# Write\n\nStatus: Doing\nDue: October 30, 2026\n\nThe draft.\n",
  });
  await page.keyboard.press("Control+p");
  await page.keyboard.type("import");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import" });
  await dialog.getByRole("radio", { name: /A Notion export/ }).check();
  await dialog.getByRole("button", { name: "Choose and import…" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Imported 3 notes into Notion.");
  expect(await fileText(page, "Notion/Home.md")).toBe(
    "See [[Notion/Tasks]] and [[Notion/Tasks/Write]].\n",
  );
  expect(await fileText(page, "Notion/Tasks/Write.md")).toBe(
    "---\nStatus: Doing\nDue: 2026-10-30\n---\nThe draft.\n",
  );

  await dialog.getByRole("button", { name: "Open Home" }).click();
  await page
    .getByRole("textbox", { name: "Home, note text" })
    .getByText("Notion/Tasks", { exact: true })
    .click();
  await expect(page.locator("#note-title")).toHaveText("Tasks");
  const database = page.getByRole("region", { name: "Database" });
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveText(["Write"]);
  await expect(database.getByLabel("Due of Write", { exact: true })).toHaveValue("2026-10-30");
  expect(errors).toEqual([]);
});

test("a Logseq graph imports with its properties, tasks and block references as Obsidian writes them", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await openSample(page);
  const block = "64f1c2d3-0a1b-4c2d-8e3f-123456789abc";
  await willImport(page, "my graph", {
    "pages/Plan.md": `status:: active\n\n- TODO Write it\n  id:: ${block}\n`,
    "journals/2026_10_30.md": `- Started ((${block}))\n`,
    "logseq/config.edn": "{}",
  });
  await page.keyboard.press("Control+p");
  await page.keyboard.type("import");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import" });
  await dialog.getByRole("radio", { name: /A Logseq graph/ }).check();
  await dialog.getByRole("button", { name: "Choose and import…" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Imported 2 notes into my graph.");
  expect(await fileText(page, "my graph/pages/Plan.md")).toBe(
    `---\nstatus: active\n---\n\n- [ ] Write it ^${block}\n`,
  );
  expect(await fileText(page, "my graph/journals/2026-10-30.md")).toBe(
    `---\naliases:\n  - Oct 30th, 2026\n---\n- Started [[my graph/pages/Plan#^${block}]]\n`,
  );
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
