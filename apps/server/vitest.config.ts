import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Signing in checks an argon2id hash, slow by design: a test of the
    // limits signs in dozens of times, which takes seconds on a CI runner.
    testTimeout: 30_000,
  },
});
