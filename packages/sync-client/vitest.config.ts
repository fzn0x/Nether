import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Two devices sync through a real server, whose sign-in checks argon2id
    // hashes, slow by design.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
