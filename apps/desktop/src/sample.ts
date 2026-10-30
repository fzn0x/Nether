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

![[Welcome]]
`,
  "Projects/Roadmap.md": `---
aliases: [Plan]
---

# Roadmap

> [!note] Local first
> The desktop app works with no account and no server.

| Phase | Scope |
| ----- | ----- |
| 1 | Local-first notes |
| 2 | Databases and structure |

![[sketch.svg|240]]
`,
  "Projects/Ideas.md": `# Ideas

A ==highlight==, some $e^{i\\pi}$ and a %%hidden comment%%.

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

\`\`\`ts
const answer: number = 42;
\`\`\`

\`\`\`mermaid
flowchart LR
  Write --> Link --> Find
\`\`\`
`,
  "attachments/diagram.png": "not really an image",
  "attachments/sketch.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">
  <rect x="8" y="8" width="224" height="104" rx="12" fill="#c43d18" fill-opacity="0.12" stroke="#c43d18" stroke-width="2"/>
  <circle cx="60" cy="60" r="22" fill="#c43d18"/>
  <path d="M100 60h100" stroke="#c43d18" stroke-width="4" stroke-linecap="round"/>
</svg>
`,
};
