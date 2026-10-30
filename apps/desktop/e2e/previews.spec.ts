import { expect, test } from "@playwright/test";
import { errorsOf, openSample } from "./helpers.ts";

test("a web link's preview is fetched only when asked, and kept", async ({ page }) => {
  const errors = errorsOf(page);
  const notes = await openSample(page);
  // A web link in Ideas, and a stand-in for the app's fetcher that counts what it is asked.
  await page.evaluate(async () => {
    const preview = (
      globalThis as unknown as {
        netherPreview: {
          files: {
            read(path: string): Promise<{ text: string }>;
            edit(path: string, text: string): void;
          };
          fetchPreview?: (url: string) => Promise<unknown>;
          fetched?: string[];
        };
      }
    ).netherPreview;
    preview.fetched = [];
    preview.fetchPreview = (url) => {
      preview.fetched?.push(url);
      return Promise.resolve({ title: "Nether", description: "Notes you own.", site: "GitHub" });
    };
    const ideas = await preview.files.read("Projects/Ideas.md");
    preview.files.edit("Projects/Ideas.md", `${ideas.text}\n<https://example.test/page>\n`);
  });
  const fetched = () =>
    page.evaluate(
      () =>
        (globalThis as unknown as { netherPreview: { fetched: string[] } }).netherPreview.fetched,
    );

  await notes.getByRole("button", { name: /Ideas/ }).click();
  const card = page.locator(".bookmark-card");
  await expect(card.locator(".bookmark-url")).toHaveText("https://example.test/page");
  await expect(card.locator(".bookmark-title")).toHaveCount(0);
  expect(await fetched()).toEqual([]);

  await card.getByRole("button", { name: "Show preview" }).click();
  await expect(card.locator(".bookmark-site")).toHaveText("GitHub");
  await expect(card.locator(".bookmark-title")).toHaveText("Nether");
  await expect(card.locator(".bookmark-description")).toHaveText("Notes you own.");
  await expect(card.getByRole("button", { name: "Show preview" })).toHaveCount(0);

  // Shown again from what the vault keeps, without fetching.
  await notes.getByRole("button", { name: /Welcome/ }).click();
  await notes.getByRole("button", { name: /Ideas/ }).click();
  await expect(card.locator(".bookmark-title")).toHaveText("Nether");
  expect(await fetched()).toEqual(["https://example.test/page"]);
  const kept = await page.evaluate(
    async () =>
      (
        await (
          globalThis as unknown as {
            netherPreview: { files: { read(path: string): Promise<{ text: string }> } };
          }
        ).netherPreview.files.read(".nether/previews.json")
      ).text,
  );
  expect(JSON.parse(kept)).toEqual({
    "https://example.test/page": { title: "Nether", description: "Notes you own.", site: "GitHub" },
  });
  expect(errors).toEqual([]);
});
