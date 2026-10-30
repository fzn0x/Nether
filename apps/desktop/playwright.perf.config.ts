import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.ts";

// The performance tests: one at a time, on the reference vault, with no retries.
export default defineConfig({
  ...base,
  testDir: "perf",
  retries: 0,
  workers: 1,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
