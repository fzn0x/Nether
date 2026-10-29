import { defineConfig, devices } from "@playwright/test";

const ci = process.env.CI !== undefined;

// The page runs in Chromium here, as in WebView2. Desktop-only behavior is
// tested on the Go side.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !ci,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
