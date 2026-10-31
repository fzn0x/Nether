import { expect, test } from "@playwright/test";
import { errorsOf, openSample, violations } from "./helpers.ts";

test("notes open in tabs, which the keyboard moves between and closes", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  const tabs = page.getByRole("tablist", { name: "Open notes" }).getByRole("tab");
  await expect(tabs).toHaveText(["Welcome×"]);

  // A click opens a note in place of the one shown; Ctrl and a click, in a new tab.
  await notes.getByRole("button", { name: /Roadmap/ }).click();
  await expect(tabs).toHaveText(["Roadmap×"]);
  await notes.getByRole("button", { name: /Ideas/ }).click({ modifiers: ["ControlOrMeta"] });
  await expect(tabs).toHaveText(["Roadmap×", "Ideas×"]);
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#note-title")).toHaveText("Ideas");
  // A middle click, too.
  await notes.getByRole("button", { name: /Welcome/ }).click({ button: "middle" });
  await expect(tabs).toHaveText(["Roadmap×", "Ideas×", "Welcome×"]);
  expect(await violations(page)).toEqual([]);

  // The tab's own keys: the arrows show the next, Delete closes.
  await tabs.nth(2).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(0)).toBeFocused();
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
  await page.keyboard.press("Delete");
  await expect(tabs).toHaveText(["Ideas×", "Welcome×"]);

  // The commands: the next tab, and closing it.
  await page.locator("#note-title").click();
  await page.keyboard.press("ControlOrMeta+Tab");
  await expect(page.locator("#note-title")).toHaveText("Welcome");
  await page.keyboard.press("ControlOrMeta+w");
  await expect(tabs).toHaveText(["Ideas×"]);
  // Its × closes a tab, the last leaving none open.
  await tabs.first().getByText("×").click();
  await expect(page.getByText("Select a note to read it.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a note opens to the right, in a pane of its own", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await notes.getByRole("button", { name: /Roadmap/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open to the right" }).click();

  const left = page.getByRole("region", { name: "Left pane" });
  const right = page.getByRole("region", { name: "Right pane" });
  await expect(left.getByRole("tab")).toHaveText(["Welcome×"]);
  await expect(right.getByRole("tab")).toHaveText(["Roadmap×"]);
  await expect(right.locator("#note-title-right")).toHaveText("Roadmap");
  expect(await violations(page)).toEqual([]);

  // The pane clicked in is the one a note opens in.
  await left.locator("#note-title").click();
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await expect(left.getByRole("tab")).toHaveText(["Ideas×"]);
  await expect(right.getByRole("tab")).toHaveText(["Roadmap×"]);

  // Closing the left pane's last tab leaves the right one, alone.
  await left.getByRole("tab").getByText("×").click();
  await expect(page.getByRole("region", { name: /pane/ })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Open notes" }).getByRole("tab")).toHaveText([
    "Roadmap×",
  ]);
  await expect(page.locator("#note-title")).toHaveText("Roadmap");
  expect(errors).toEqual([]);
});
