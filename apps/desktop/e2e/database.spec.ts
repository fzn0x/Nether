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

test("a relation links rows of two databases both ways, each in its row's file", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await openSample(page);
  const newDatabase = async (title: string) => {
    await page.keyboard.press("Control+p");
    await page.keyboard.type("new database");
    await page.keyboard.press("Enter");
    await expect(page.locator("#note-title")).toHaveText(title);
  };
  const database = page.getByRole("region", { name: "Database" });
  await newDatabase("Untitled database");
  await database.getByRole("button", { name: "New row" }).click();
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveText(["Untitled"]);

  // A second database, related to the first both ways.
  await newDatabase("Untitled database 2");
  await database.getByRole("button", { name: "Properties" }).click();
  await database.getByRole("textbox", { name: "Property name" }).fill("Projects");
  await database
    .getByRole("combobox", { name: "Type of the new property" })
    .selectOption("relation");
  await database
    .getByRole("combobox", { name: "Database it links to" })
    .selectOption({ label: "Untitled database" });
  await expect(database.getByRole("checkbox", { name: "Both ways" })).toBeChecked();
  await expect(database.getByRole("textbox", { name: "Name of the property there" })).toHaveValue(
    "Untitled database 2",
  );
  await database.getByRole("button", { name: "Add a property" }).click();
  await database.getByRole("button", { name: "New row" }).click();
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveText(["Untitled"]);

  // The first database's row, by its name; as two notes have it, by its path.
  const cell = database.getByLabel("Projects of Untitled", { exact: true });
  await cell.fill("Untitled");
  await cell.press("Enter");
  await expect(database.getByRole("table").locator(".property-chip")).toHaveText(["Untitled×"]);
  await expect
    .poll(() => fileText(page, "Untitled database 2/Untitled.md"))
    .toBe('---\nProjects:\n  - "[[Untitled database/Untitled]]"\n---\n');
  // And back, in the other row's file and the other database's schema.
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled.md"))
    .toBe('---\nUntitled database 2:\n  - "[[Untitled database 2/Untitled]]"\n---\n');
  await expect
    .poll(() => fileText(page, "Untitled database.md"))
    .toContain("    - key: Untitled database 2\n      type: relation\n");

  // Taken away here, taken away there.
  await database.getByRole("button", { name: "Remove Untitled" }).click();
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled.md"))
    .toBe("---\nUntitled database 2: []\n---\n");
  expect(errors).toEqual([]);
});

test("a rollup works out a value from the related rows, and writes it nowhere", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await openSample(page);
  const database = page.getByRole("region", { name: "Database" });
  const newDatabase = async (title: string) => {
    await page.keyboard.press("Control+p");
    await page.keyboard.type("new database");
    await page.keyboard.press("Enter");
    await expect(page.locator("#note-title")).toHaveText(title);
    await database.getByRole("button", { name: "Properties" }).click();
  };
  const name = (text: string) =>
    database.getByRole("textbox", { name: "Property name" }).fill(text);
  const type = (value: string) =>
    database.getByRole("combobox", { name: "Type of the new property" }).selectOption(value);
  const add = () => database.getByRole("button", { name: "Add a property" }).click();

  // Tasks, with their hours.
  await newDatabase("Untitled database");
  await name("Hours");
  await type("number");
  await add();
  await database.getByRole("button", { name: "New row" }).click();
  await database.getByRole("button", { name: "New row" }).click();
  for (const [row, hours] of [
    ["Untitled", "3"],
    ["Untitled 2", "5"],
  ] as const) {
    await database.getByLabel(`Hours of ${row}`, { exact: true }).fill(hours);
    await database.getByLabel(`Hours of ${row}`, { exact: true }).press("Enter");
  }
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled 2.md"))
    .toBe("---\nHours: 5\n---\n");

  // A project, its tasks related one way, and their hours summed.
  await newDatabase("Untitled database 2");
  await name("Tasks");
  await type("relation");
  await database
    .getByRole("combobox", { name: "Database it links to" })
    .selectOption({ label: "Untitled database" });
  await database.getByRole("checkbox", { name: "Both ways" }).uncheck();
  await add();
  await name("Total");
  await type("rollup");
  await expect(database.getByRole("combobox", { name: "Relation to roll up" })).toHaveValue(
    "Tasks",
  );
  await database
    .getByRole("combobox", { name: "Property of the related rows" })
    .selectOption("Hours");
  await database.getByRole("combobox", { name: "Calculate" }).selectOption("sum");
  await add();
  await database.getByRole("button", { name: "New row" }).click();
  const tasks = database.getByLabel("Tasks of Untitled", { exact: true });
  for (const task of ["Untitled", "Untitled 2"]) {
    await tasks.fill(task);
    await tasks.press("Enter");
  }
  const total = database.getByRole("table").locator(".database-rollup");
  await expect(total).toHaveText("8");
  // Only the links are written; the total is worked out.
  await expect
    .poll(() => fileText(page, "Untitled database 2/Untitled.md"))
    .toBe('---\nTasks:\n  - "[[Untitled database/Untitled]]"\n  - "[[Untitled 2]]"\n---\n');

  // Filtered by what it works out.
  await database.getByRole("button", { name: "Filter" }).click();
  await database.getByRole("button", { name: "Add a condition" }).click();
  await database.getByRole("combobox", { name: "Property of condition 1" }).selectOption("Total");
  await database
    .getByRole("combobox", { name: "Comparison of condition 1" })
    .selectOption("greaterThan");
  const value = database.getByRole("spinbutton", { name: "Value of condition 1" });
  await value.fill("5");
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveText(["Untitled"]);
  await value.fill("10");
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a formula works out each row's value from its others, and writes it nowhere", async ({
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
  const name = database.getByRole("textbox", { name: "Property name" });
  const type = database.getByRole("combobox", { name: "Type of the new property" });
  const add = database.getByRole("button", { name: "Add a property" });
  for (const property of ["Price", "Count"]) {
    await name.fill(property);
    await type.selectOption("number");
    await add.click();
  }
  await database.getByRole("button", { name: "New row" }).click();
  await database.getByRole("button", { name: "New row" }).click();
  for (const [row, price, count] of [
    ["Untitled", "3", "4"],
    ["Untitled 2", "2", "5"],
  ] as const) {
    for (const [property, value] of [
      ["Price", price],
      ["Count", count],
    ] as const) {
      await database.getByLabel(`${property} of ${row}`, { exact: true }).fill(value);
      await database.getByLabel(`${property} of ${row}`, { exact: true }).press("Enter");
    }
  }

  // A formula that cannot be read says why, and cannot be added.
  await name.fill("Total");
  await type.selectOption("formula");
  const formula = database.getByRole("textbox", { name: "Formula", exact: true });
  await formula.fill("Price *");
  await expect(database.getByText("The formula ends too soon")).toBeVisible();
  await expect(add).toBeDisabled();
  await formula.fill("Price * Count");
  await add.click();
  const total = database.getByRole("table").locator(".database-rollup");
  await expect(total).toHaveText(["12", "10"]);
  await expect
    .poll(() => fileText(page, "Untitled database/Untitled.md"))
    .toBe("---\nPrice: 3\nCount: 4\n---\n");
  // Sorted by what it works out.
  await database.getByRole("table").getByRole("button", { name: "Total" }).click();
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveText([
    "Untitled 2",
    "Untitled",
  ]);

  // Changed, and worked out again.
  const edit = database.getByRole("textbox", { name: "Formula of Total" });
  await edit.fill("Price + Count");
  await edit.press("Enter");
  await expect(total).toHaveText(["7", "7"]);
  await expect
    .poll(() => fileText(page, "Untitled database.md"))
    .toContain("      type: formula\n      formula: Price + Count\n");

  // What cannot be worked out shows in its cells.
  await name.fill("Bad");
  await type.selectOption("formula");
  await formula.fill("Price / 0");
  await add.click();
  await expect(database.getByRole("table").locator(".database-error")).toHaveText([
    "Error: The formula divides by zero",
    "Error: The formula divides by zero",
  ]);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a view exports as CSV: its rows, in its order, with the properties it shows", async ({
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
  const name = database.getByRole("textbox", { name: "Property name" });
  const type = database.getByRole("combobox", { name: "Type of the new property" });
  for (const [property, kind] of [
    ["Points", "number"],
    ["Note", "text"],
  ] as const) {
    await name.fill(property);
    await type.selectOption(kind);
    await database.getByRole("button", { name: "Add a property" }).click();
  }
  await database.getByRole("button", { name: "New row" }).click();
  await database.getByRole("button", { name: "New row" }).click();
  for (const [row, points, note] of [
    ["Untitled", "3", 'A "big" one'],
    ["Untitled 2", "5", "Small, quick"],
  ] as const) {
    for (const [property, value] of [
      ["Points", points],
      ["Note", note],
    ] as const) {
      const cell = database.getByLabel(`${property} of ${row}`, { exact: true });
      await cell.fill(value);
      await cell.press("Enter");
    }
  }
  // Sorted as the view shows it, most points first.
  await database.getByRole("table").getByRole("button", { name: "Points" }).click();
  await database.getByRole("table").getByRole("button", { name: "Points" }).click();
  await expect(database.getByRole("table").getByRole("rowheader")).toHaveText([
    "Untitled 2",
    "Untitled",
  ]);

  await database.getByRole("button", { name: "Export CSV" }).click();
  await expect(database.getByRole("status")).toHaveText("Saved to Untitled database - Table.csv.");
  const exported = await page.evaluate(() => {
    const preview = (
      globalThis as unknown as {
        netherPreview: {
          exports: { name: string; kind: string; entries: { path: string; text?: string }[] }[];
        };
      }
    ).netherPreview;
    return preview.exports.at(-1);
  });
  expect(exported?.kind).toBe("csv");
  expect(exported?.entries).toEqual([
    {
      path: "Untitled database - Table.csv",
      text:
        "\uFEFFName,Points,Note\r\n" +
        'Untitled 2,5,"Small, quick"\r\n' +
        'Untitled,3,"A ""big"" one"\r\n',
    },
  ]);
  expect(errors).toEqual([]);
});
