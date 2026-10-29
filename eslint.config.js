// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/dist/",
    "**/build/",
    "**/coverage/",
    "**/.astro/",
    "**/.mygo/",
    "**/playwright-report/",
    "**/test-results/",
    "apps/desktop/src/mygo.ts",
    "docs/adr/0002-editor-spike/",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // The site's types come from `astro sync`, which needs a newer Node.js
    // than the rest of the repository; its typecheck script covers them.
    files: ["apps/docs-site/**"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Enterprise features plug in through extension points; nothing
    // outside enterprise/ may depend on them (docs/requirements.md#editions).
    ignores: ["enterprise/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@nether/enterprise-*", "**/enterprise/**"],
              message:
                "Code outside enterprise/ must not depend on it; register an extension point instead.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
