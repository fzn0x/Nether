// Renders the desktop app's icon.svg to the web app's install icons,
// public/icon-192.png and public/icon-512.png, with transparent corners,
// and copies the SVG beside them. Run it after changing the icon:
// pnpm --filter @nether/web icons
import { copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const source = new URL("../../desktop/icon.svg", import.meta.url);
const svg = await readFile(source, "utf8");
await copyFile(source, new URL("../public/icon.svg", import.meta.url));
const browser = await chromium.launch();
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${String(size)}px;height:${String(size)}px}</style>${svg}`,
    );
    await page.screenshot({
      path: fileURLToPath(new URL(`../public/icon-${String(size)}.png`, import.meta.url)),
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
