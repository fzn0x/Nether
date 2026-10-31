// A vault's appearance: light or dark apart from the system, a theme and
// CSS snippets from the vault's own folders, kept for the vault.
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

/** Changes a file of the sample vault as another app would. */
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

/** A design token as the page has it now. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

test("a vault's appearance: dark apart from the system, a theme and snippets, kept for it", async ({
  page,
}) => {
  const errors = errorsOf(page);
  await page.emulateMedia({ colorScheme: "light" });
  await openSample(page);
  await editFile(page, ".nether/themes/Ocean.css", ":root { --accent: rgb(0, 102, 204); }\n");
  await editFile(page, ".nether/snippets/wide.css", ":root { --wide: on; }\n");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-mode", "light");

  await page.keyboard.press("Control+p");
  await page.keyboard.type("appearance");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Appearance" });
  await expect(dialog.getByRole("radio", { name: "As the system" })).toBeChecked();

  // Dark, whatever the system prefers.
  await dialog.getByRole("radio", { name: "Dark" }).check();
  await expect(html).toHaveAttribute("data-mode", "dark");
  expect(await token(page, "--bg")).toBe("#131118");

  // The dialog as Nether's own colors draw it; a theme's are its author's.
  const results = await new AxeBuilder({ page })
    .include("[role=dialog]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // A theme, and a snippet on it.
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("Ocean");
  await expect.poll(() => token(page, "--accent")).toBe("rgb(0, 102, 204)");
  await dialog.getByRole("checkbox", { name: "wide" }).check();
  await expect.poll(() => token(page, "--wide")).toBe("on");
  // Not in print, where a PDF is made in Nether's own look.
  await page.emulateMedia({ media: "print" });
  expect(await token(page, "--wide")).toBe("");
  await page.emulateMedia({ media: "screen" });
  await expect
    .poll(
      async () => JSON.parse((await fileText(page, ".nether/appearance.json")) ?? "{}") as unknown,
    )
    .toEqual({ mode: "dark", theme: "Ocean", snippets: ["wide"] });

  // A theme changed in its file shows once reloaded.
  await editFile(page, ".nether/themes/Ocean.css", ":root { --accent: rgb(0, 128, 96); }\n");
  await dialog.getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => token(page, "--accent")).toBe("rgb(0, 128, 96)");

  // Back to Nether's own, and the snippet off.
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption({ label: "Nether's own" });
  await dialog.getByRole("checkbox", { name: "wide" }).uncheck();
  await expect.poll(() => token(page, "--wide")).toBe("");
  expect(await token(page, "--accent")).toBe("#ff7a50");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(html).toHaveAttribute("data-mode", "dark");

  // Closing the vault leaves the page as the system shows it.
  await page.getByRole("button", { name: "Close vault" }).click();
  await expect(html).toHaveAttribute("data-mode", "light");
  expect(errors).toEqual([]);
});
