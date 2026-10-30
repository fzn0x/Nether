import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The page's own logic; the end-to-end tests in e2e/ run in Playwright.
    include: ["test/**/*.test.ts"],
  },
});
