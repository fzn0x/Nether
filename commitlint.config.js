/** @type {import("@commitlint/types").UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Contributions come under the Developer Certificate of Origin
    // (docs/adr/0001-license-agpl-and-dco.md): `git commit -s`.
    "trailer-exists": [2, "always", "Signed-off-by:"],
    "scope-enum": [
      1,
      "always",
      [
        "adr",
        "ai",
        "canvas",
        "ci",
        "core",
        "database",
        "deploy",
        "deps",
        "desktop",
        "docs-site",
        "editor",
        "enterprise",
        "graph",
        "markdown",
        "mobile",
        "plugin-api",
        "release",
        "search",
        "server",
        "storage",
        "sync-client",
        "tools",
        "ui",
        "web",
      ],
    ],
  },
};
