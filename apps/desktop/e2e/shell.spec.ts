import { expect, test } from "@playwright/test";

test("the shell names Nether and says where it runs", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Nether");
  await expect(page.getByRole("heading", { level: 1, name: "Nether" })).toBeVisible();
  await expect(page.getByText("Browser preview")).toBeVisible();
});

test("the shell has no errors in the console", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
