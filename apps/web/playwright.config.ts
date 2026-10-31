import { defineConfig, devices } from "@playwright/test";

const ci = process.env.CI !== undefined;

// The web app as its server serves it: the build, then a real server with
// it (e2e/server.ts), in Chromium. The tests share the server, each with
// an account of its own; they run one at a time, as they would sign in
// past the server's limits together.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  workers: 1,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm exec vite build && node e2e/server.ts",
    url: "http://127.0.0.1:4175/health",
    reuseExistingServer: !ci,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
