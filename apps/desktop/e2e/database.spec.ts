// A database made in the app: its properties, rows and their values, kept
// in the files as ADR 0018 has it, and a view's sorts, groups and filters.
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

test("a database keeps its schema in its note and its values in its rows, and a view sorts, groups and filters them", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await openSample(page);
  await page.keyboard.press("Control+p");
  await page.keyboard.type("new database");
  await page.keyboard.press("Enter");
  await expect(page.locator("#note-title")).toHaveText("Untitled database");
  const database = page.getByRole("region", { name: "Database" });
  await expect(database.getByRole("tab", { name: "Table" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Two properties, shown in the table as they are added.
  await database.getByRole("button", { name: "Properties" }).click();
  const add = async (name: string, type: string) => {
    await database.getByRole("textbox", { name: "Property name" }).fill(name);
    await database.getByRole("combobox", { name: "Type of the new property" }).selectOption(type);
    await database.getByRole("button", { name: "Add a property" }).click();
  };
  await add("Status", "Select");
  await add("Points", "Number");
  const table = database.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["Name", "Status", "Points"]);

  // Two rows, notes in the folder beside the database.
  await database.getByRole("button", { name: "New row" }).click();
  await database.getByRole("button", { name: "New row" }).click();
  await expect(table.getByRole("rowheader")).toHaveText(["Untitled", "Untitled 2"]);
  // A select is a text field until it has options to suggest.
  const cell = (name: string, row: string) =>
    database.getByLabel(`${name} of ${row}`, { exact: true });
  for (const [row, status, points] of [
    ["Untitled", "Doing", "8"],
    ["Untitled 2", "Done", "3"],
  ] as const) {
    await cell("Status", row).fill(status);
    await cell("Status", row).press("Enter");
    await cell("Points", row).fill(points);
    await cell("Points", row).press("Enter");
  }
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled.md"))
    .toBe("---\nStatus: Doing\nPoints: 8\n---\n");
  // The schema, with the options its values added, in the database's note.
  await expect
    .poll(() => fileText(page, "Untitled database.md"))
    .toContain("    - key: Status\n      type: select\n      options:\n        - name: Doing\n");

  // Sorted by points one way, then the other.
  await table.getByRole("button", { name: "Points" }).click();
  await expect(table.getByRole("rowheader")).toHaveText(["Untitled 2", "Untitled"]);
  await table.getByRole("button", { name: "Points" }).click();
  await expect(table.getByRole("rowheader")).toHaveText(["Untitled", "Untitled 2"]);

  // Grouped by status: its options in order, then rows with none.
  await database.getByRole("combobox", { name: "Group by" }).selectOption("Status");
  await expect(table.locator(".database-group")).toHaveText(["Doing 1", "Done 1", "No value 0"]);
  await database.getByRole("combobox", { name: "Group by" }).selectOption("");

  // Filtered to the rows with more than five points.
  await database.getByRole("button", { name: "Filter" }).click();
  await database.getByRole("button", { name: "Add a condition" }).click();
  await database.getByRole("combobox", { name: "Property of condition 1" }).selectOption("Points");
  await database
    .getByRole("combobox", { name: "Comparison of condition 1" })
    .selectOption("greaterThan");
  await database.getByRole("spinbutton", { name: "Value of condition 1" }).fill("5");
  await expect(table.getByRole("rowheader")).toHaveText(["Untitled"]);

  // The Obsidian base beside it, written from the schema.
  await expect
    .poll(() => fileText(page, "Untitled database.base"))
    .toContain("    order:\n      - file.name\n      - Status\n      - Points\n");
  await expect
    .poll(() => fileText(page, "Untitled database.base"))
    .toContain("    filters:\n      and:\n        - Points > 5\n");
  // A column hidden in Obsidian is hidden here, the filter and sort kept.
  const base = (await fileText(page, "Untitled database.base")) ?? "";
  await editFile(page, "Untitled database.base", base.replace("      - Status\n", ""));
  await expect(table.getByRole("columnheader")).toHaveText(["Name", "Points ↓"]);
  await expect(table.getByRole("rowheader")).toHaveText(["Untitled"]);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // A row's name opens it.
  await table.getByRole("button", { name: "Untitled", exact: true }).click();
  await expect(page.locator("#note-title")).toHaveText("Untitled");
  expect(errors).toEqual([]);
});

test("a view shows its rows as a board, a list or a gallery, and a card moves between columns", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await openSample(page);
  await page.keyboard.press("Control+p");
  await page.keyboard.type("new database");
  await page.keyboard.press("Enter");
  await expect(page.locator("#note-title")).toHaveText("Untitled database");
  const database = page.getByRole("region", { name: "Database" });
  await database.getByRole("button", { name: "Properties" }).click();
  const add = async (name: string, type: string) => {
    await database.getByRole("textbox", { name: "Property name" }).fill(name);
    await database.getByRole("combobox", { name: "Type of the new property" }).selectOption(type);
    await database.getByRole("button", { name: "Add a property" }).click();
  };
  // A board cannot be made before there is something for its columns.
  await database.getByRole("combobox", { name: "Layout" }).selectOption("board");
  await expect(database.getByRole("alert")).toContainText("A board needs a select");
  await add("Status", "Select");
  await add("Cover", "File");
  await database.getByRole("button", { name: "New row" }).click();
  await database.getByRole("button", { name: "New row" }).click();
  const table = database.getByRole("table");
  await expect(table.getByRole("rowheader")).toHaveText(["Untitled", "Untitled 2"]);
  for (const [row, status] of [
    ["Untitled", "Doing"],
    ["Untitled 2", "Done"],
  ] as const) {
    await database.getByLabel(`Status of ${row}`, { exact: true }).fill(status);
    await database.getByLabel(`Status of ${row}`, { exact: true }).press("Enter");
  }
  await database.getByLabel("Cover of Untitled", { exact: true }).fill("[[sketch.svg]]");
  await database.getByLabel("Cover of Untitled", { exact: true }).press("Enter");

  // A board, its columns the status's options, then the rows with none.
  await database.getByRole("combobox", { name: "Layout" }).selectOption("board");
  await expect(database.getByRole("combobox", { name: "Columns" })).toHaveValue("Status");
  const column = (name: string) => database.getByRole("region", { name, exact: true });
  await expect(column("Doing").getByRole("listitem")).toHaveCount(1);
  await expect(column("Done").getByRole("listitem")).toHaveCount(1);
  await expect(column("No value").getByRole("listitem")).toHaveCount(0);
  // Moved by its menu, as a keyboard moves it; its file follows.
  await column("Doing")
    .getByRole("combobox", { name: "Move Untitled to" })
    .selectOption({ label: "Done" });
  await expect(column("Done").getByRole("listitem")).toHaveCount(2);
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled.md"))
    .toContain("Status: Done\n");
  // A row made in a column has its value.
  await column("Doing").getByRole("button", { name: "New in Doing" }).click();
  await expect(column("Doing").getByRole("button", { name: "Untitled 3" })).toBeVisible();
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled 3.md"))
    .toBe("---\nStatus: Doing\n---\n");
  // The base shows it as Obsidian's kanban.
  await expect
    .poll(() => fileText(page, "Untitled database.base"))
    .toContain("  - type: kanban\n    name: Table\n");

  // A list, each row by its name.
  await database.getByRole("combobox", { name: "Layout" }).selectOption("list");
  await expect(database.getByRole("list").getByRole("button")).toHaveText([
    "Untitled 3",
    "Untitled",
    "Untitled 2",
  ]);

  // A gallery, with the cover a file property names.
  await database.getByRole("combobox", { name: "Group by" }).selectOption("");
  await database.getByRole("combobox", { name: "Layout" }).selectOption("gallery");
  await database.getByRole("combobox", { name: "Cover" }).selectOption("Cover");
  const card = (name: string) =>
    database.getByRole("listitem").filter({ has: page.getByRole("button", { name, exact: true }) });
  await expect(card("Untitled").locator("img")).toHaveAttribute("src", /.+/);
  await expect(card("Untitled 2").locator("img")).toHaveCount(0);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a calendar places rows on their days, and a timeline from their date to their end", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await page.clock.setFixedTime(new Date("2026-11-12T10:00:00"));
  await openSample(page);
  await page.keyboard.press("Control+p");
  await page.keyboard.type("new database");
  await page.keyboard.press("Enter");
  await expect(page.locator("#note-title")).toHaveText("Untitled database");
  const database = page.getByRole("region", { name: "Database" });
  await database.getByRole("button", { name: "Properties" }).click();
  for (const name of ["Due", "End"]) {
    await database.getByRole("textbox", { name: "Property name" }).fill(name);
    await database.getByRole("combobox", { name: "Type of the new property" }).selectOption("Date");
    await database.getByRole("button", { name: "Add a property" }).click();
  }
  await database.getByRole("button", { name: "New row" }).click();
  await database.getByRole("button", { name: "New row" }).click();
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveText([
    "Untitled",
    "Untitled 2",
  ]);
  for (const [name, value] of [
    ["Due", "2026-11-10"],
    ["End", "2026-11-14"],
  ] as const) {
    await database.getByLabel(`${name} of Untitled`, { exact: true }).fill(value);
    await database.getByLabel(`${name} of Untitled`, { exact: true }).press("Enter");
  }
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled.md"))
    .toBe("---\nDue: 2026-11-10\nEnd: 2026-11-14\n---\n");

  // A calendar of this month, by the first date property.
  await database.getByRole("combobox", { name: "Layout" }).selectOption("calendar");
  await expect(database.getByRole("combobox", { name: "Date" })).toHaveValue("Due");
  await expect(database.getByRole("heading", { name: "November 2026" })).toBeVisible();
  const day = (name: string) => database.getByRole("cell").filter({ hasText: name });
  await expect(
    day("Tuesday, November 10, 2026").getByRole("button", { name: "Untitled" }),
  ).toBeVisible();
  await expect(database.getByRole("region", { name: "No date" })).toContainText("Untitled 2");
  // A row made on a day has that date.
  await database.getByRole("button", { name: "New on Friday, November 13, 2026" }).click();
  await expect(
    day("Friday, November 13, 2026").getByRole("button", { name: "Untitled 3" }),
  ).toBeVisible();
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled 3.md"))
    .toBe("---\nDue: 2026-11-13\n---\n");
  await database.getByRole("button", { name: "Next month" }).click();
  await expect(database.getByRole("heading", { name: "December 2026" })).toBeVisible();
  await database.getByRole("button", { name: "Today" }).click();
  await expect(database.getByRole("heading", { name: "November 2026" })).toBeVisible();
  const violations = async () =>
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
        .analyze()
    ).violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
    );
  expect(await violations()).toEqual([]);

  // A timeline, each bar from its date to its end.
  await database.getByRole("combobox", { name: "Layout" }).selectOption("timeline");
  await database.getByRole("combobox", { name: "End" }).selectOption("End");
  const bars = database.locator(".database-timeline-rows");
  await expect(bars.getByRole("listitem").filter({ hasText: "Untitled" }).first()).toContainText(
    "Tuesday, November 10, 2026 to Saturday, November 14, 2026",
  );
  await expect(bars.getByRole("listitem").filter({ hasText: "Untitled 3" })).toContainText(
    "Friday, November 13, 2026",
  );
  await expect(database.getByRole("region", { name: "No date" })).toContainText("Untitled 2");
  expect(await violations()).toEqual([]);
  expect(errors).toEqual([]);
});
