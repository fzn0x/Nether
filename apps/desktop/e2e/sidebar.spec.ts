// The sidebar's width: dragged on its edge, moved with the arrow keys as a
// window splitter, put back with a double click, and remembered.
import { expect, test } from "@playwright/test";
import { openSampleTree, violations } from "./helpers.ts";

test("the sidebar is resized by dragging, by keys, and remembers its width", async ({ page }) => {
  await openSampleTree(page);
  const handle = page.getByRole("separator", { name: "Sidebar width" });
  const sidebar = page.locator("#sidebar");
  await expect(handle).toHaveAttribute("aria-valuenow", "336");

  const box = await handle.boundingBox();
  if (box === null) throw new Error("The handle has no box.");
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 103, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "436");
  expect(Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(436);

  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "420");
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "200");
  expect(await violations(page)).toEqual([]);

  await page.reload();
  await page.getByRole("button", { name: "Open a folder" }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "200");
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", "336");
});
