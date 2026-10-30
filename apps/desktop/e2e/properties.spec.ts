import { expect, test } from "@playwright/test";
import { errorsOf, openSample } from "./helpers.ts";

test("a note's properties edit its frontmatter, each by its type", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const properties = page.getByRole("region", { name: "Properties" });
  // The tags property is a list: its values are chips.
  const tags = properties.getByRole("group", { name: "tags" });
  await expect(tags.locator(".property-chip")).toHaveText(["start×"]);
  await tags.getByRole("textbox", { name: "tags" }).fill("intro");
  await page.keyboard.press("Enter");
  await expect(tags.locator(".property-chip")).toHaveText(["start×", "intro×"]);

  // A new property, named and typed.
  await properties.getByRole("button", { name: "Add a property" }).click();
  const name = properties.getByRole("textbox", { name: "Property name" }).last();
  await expect(name).toBeFocused();
  await name.fill("done");
  await page.keyboard.press("Enter");
  const done = properties.getByRole("group", { name: "done" });
  await done.getByRole("combobox", { name: "Type of done" }).selectOption("checkbox");
  await done.getByRole("checkbox", { name: "done" }).check();

  // The frontmatter has them.
  await page.getByRole("button", { name: "Markdown source" }).click();
  const source = page.getByRole("textbox", { name: "Welcome, Markdown source" });
  await expect(source).toContainText("tags: [start, intro]");
  await expect(source).toContainText("done: true");
  expect(errors).toEqual([]);
});

test("another app's change to a property shows in the note", async ({ page }) => {
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Roadmap/ }).click();
  const aliases = page
    .getByRole("region", { name: "Properties" })
    .getByRole("group", { name: "aliases" });
  await expect(aliases.locator(".property-chip")).toHaveText(["Plan×"]);
  await page.evaluate(async () => {
    const preview = (
      globalThis as unknown as {
        netherPreview: {
          files: {
            read(path: string): Promise<{ text: string }>;
            edit(path: string, text: string): void;
          };
        };
      }
    ).netherPreview;
    const file = await preview.files.read("Projects/Roadmap.md");
    preview.files.edit("Projects/Roadmap.md", file.text.replace("[Plan]", "[Plan, Schedule]"));
  });
  await expect(aliases.locator(".property-chip")).toHaveText(["Plan×", "Schedule×"]);
});
