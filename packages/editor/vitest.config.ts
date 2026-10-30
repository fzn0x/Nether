import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The requirements ask for at least 80% coverage of the editor.
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
