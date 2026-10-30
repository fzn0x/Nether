// The vault a browser preview shows: a few notes, in memory, that show what
// Nether reads.
export const sampleVault: Readonly<Record<string, string>> = {
  "Welcome.md": `---
tags: [start]
---

# Welcome to Nether

Notes are plain **Markdown** files in a folder you choose. Open a note on the
left to read it, or see [[Projects/Roadmap|the roadmap]].
`,
  "Daily/2026-10-30.md": `# Friday, 30 October

- [x] Read the sample vault
- [ ] Open a folder of my own #start
`,
  "Projects/Roadmap.md": `# Roadmap

> [!note] Local first
> The desktop app works with no account and no server.

| Phase | Scope |
| ----- | ----- |
| 1 | Local-first notes |
| 2 | Databases and structure |
`,
  "Projects/Ideas.md": `# Ideas

A ==highlight==, some $e^{i\\pi}$ and a %%hidden comment%%.
`,
  "attachments/diagram.png": "not really an image",
};
