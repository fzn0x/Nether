// Renders icon.svg to resources/icon.png, 1024 by 1024 with
// transparent corners: the app icon MyGO makes every platform's icon from.
// Run it after changing the SVG: pnpm --filter @nether/desktop icon
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const svg = await readFile(new URL("../icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`,
  );
  await page.screenshot({
    path: fileURLToPath(new URL("../resources/icon.png", import.meta.url)),
    omitBackground: true,
  });
} finally {
  await browser.close();
}
