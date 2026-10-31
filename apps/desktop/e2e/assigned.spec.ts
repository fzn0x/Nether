// Task assignment: the name this device goes by, set from the sidebar; what
// is assigned to it, across databases, by database, the soonest first; and
// the names person properties offer as one types.
import { type Page, expect, test } from "@playwright/test";
import { openSample, violations } from "./helpers.ts";

/** Writes a file of the sample vault as another app would. */
async function edit(page: Page, path: string, text: string): Promise<void> {
  await page.evaluate(
    ([file, next]) => {
      (
        globalThis as unknown as {
          netherPreview: { files: { edit(path: string, text: string): void } };
        }
      ).netherPreview.files.edit(file, next);
    },
    [path, text] as const,
  );
}

const tasks = `---
database:
  properties:
    - key: owner
      type: person
    - key: status
      type: select
    - key: due
      type: date
  views:
    - name: Table
      layout: table
      visible: [owner, status, due]
---
`;

test("what is assigned to me shows by database, and person fields offer names", async ({
  page,
}) => {
  await openSample(page);
  await edit(page, "Tasks.md", tasks);
  await edit(
    page,
    "Tasks/Write the guide.md",
    "---\nowner: [Ana, Ben]\nstatus: Doing\ndue: 2026-11-10\n---\n",
  );
  await edit(page, "Tasks/Fix the build.md", "---\nowner: ['[[ana]]']\ndue: 2026-11-03\n---\n");
  await edit(page, "Tasks/Plan.md", "---\nowner: Ben\n---\n");

  await page.getByRole("button", { name: "Assigned", exact: true }).click();
  await expect(page.getByText("Set the name you go by")).toBeVisible();
  await page.getByRole("button", { name: "Your name…" }).click();
  const dialog = page.getByRole("dialog", { name: "Your name" });
  await dialog.getByRole("textbox").fill("Ana");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Assigned to Ana")).toBeVisible();
  const group = page.getByRole("region", { name: "Tasks" });
  await expect(group.getByRole("listitem")).toHaveText([
    /^Fix the build.*2026-11-03/,
    /^Write the guide.*Doing · 2026-11-10/,
  ]);
  expect(await violations(page)).toEqual([]);

  // A row opens its note, whose person field offers the names used.
  await group.getByRole("button", { name: /^Write the guide/ }).click();
  await expect(page.locator("#note-title")).toHaveText("Write the guide");
  const offered = page.locator(".properties datalist option");
  await expect(offered).toHaveCount(2);
  await expect(offered.nth(0)).toHaveAttribute("value", "Ana");
  await expect(offered.nth(1)).toHaveAttribute("value", "Ben");

  // Another name, and what is assigned follows.
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("menuitem", { name: /^Your name/ }).click();
  await page.getByRole("dialog", { name: "Your name" }).getByRole("textbox").fill("ben");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Tasks" }).getByRole("listitem")).toHaveText([
    // Dated first, the soonest first; then those without a date.
    /^Write the guide/,
    /^Plan/,
  ]);
});
