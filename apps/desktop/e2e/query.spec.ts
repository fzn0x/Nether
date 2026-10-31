// A query block: a `base` code block whose filters find notes anywhere in
// the vault, shown below its code, and found again as the notes change.
import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { endOfFirstParagraph, errorsOf, openNote, openSample } from "./helpers.ts";

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

const project = (status: string, price: number) =>
  `---\nstatus: ${status}\nprice: ${String(price)}\ntags: [project]\n---\n`;

const board = `# Board

\`\`\`base
filters:
  and:
    - file.inFolder("Projects")
    - file.hasProperty("status")
formulas:
  double: price * 2
views:
  - type: table
    name: Projects
    order: [file.name, status, formula.double]
    sort:
      - property: price
        direction: DESC
  - type: list
    name: Active
    filters: status == "active"
    order: [file.name, status]
\`\`\`
`;

test("a base code block shows the notes its query finds, and finds them again as they change", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await editFile(page, "Projects/Launch.md", project("active", 12));
  await editFile(page, "Projects/Site.md", project("done", 3));
  await editFile(page, "Board.md", board);
  await notes.getByRole("button", { name: /^Board/ }).click();
  await expect(page.locator("#note-title")).toHaveText("Board");

  // The code stays, with the notes it finds below it: a table, by price.
  await expect(page.locator(".code-block pre")).toContainText('file.inFolder("Projects")');
  const query = page.getByRole("region", { name: "Notes the query finds" });
  await expect(query.getByRole("tab", { name: "Projects" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const table = query.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Name", "status", "double"]);
  await expect(table.getByRole("rowheader")).toHaveText(["Launch", "Site"]);
  await expect(table.getByRole("cell")).toHaveText(["active", "24", "done", "6"]);
  await expect(query.getByText("2 notes")).toBeVisible();

  // Another view, with its own filter, as a list.
  await query.getByRole("tab", { name: "Active" }).click();
  const list = query.getByRole("list");
  await expect(list.getByRole("button")).toHaveText(["Launch"]);
  await expect(query.getByText("1 note", { exact: true })).toBeVisible();

  // A note that changes is found again.
  await editFile(page, "Projects/Site.md", project("active", 3));
  await expect(list.getByRole("button")).toHaveText(["Launch", "Site"]);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // A note's name opens it.
  await list.getByRole("button", { name: "Site" }).click();
  await expect(page.locator("#note-title")).toHaveText("Site");
  expect(errors).toEqual([]);
});

test("a query block says why it cannot be shown", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await editFile(page, "Board.md", "```base\nfilters: 'status =='\n```\n");
  await notes.getByRole("button", { name: /^Board/ }).click();
  await expect(page.locator(".query-problem")).toHaveText(
    "This query cannot be shown. The filters: The formula ends too soon",
  );
  await editFile(page, "Board.md", '```base\nfilters: file.hasTag("start")\n```\n');
  await expect(
    page.getByRole("region", { name: "Notes the query finds" }).getByRole("rowheader"),
  ).toHaveText(["2026-10-30", "Welcome"]);
  expect(errors).toEqual([]);
});

test("the slash menu's Query makes a base block that shows the notes changed last", async ({
  page,
}) => {
  const errors = errorsOf(page);
  const editor = await openNote(page, "Welcome");
  await endOfFirstParagraph(page, editor);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/dataview");
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("textbox", { name: "Language" })).toHaveValue("base");
  const table = page.getByRole("region", { name: "Notes the query finds" }).getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Name", "file.folder", "file.mtime"]);
  // The note being written was changed last.
  await expect(table.getByRole("rowheader").first()).toHaveText("Welcome");
  expect(errors).toEqual([]);
});
