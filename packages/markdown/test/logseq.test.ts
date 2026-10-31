// A Logseq graph: its folders kept, page properties as frontmatter, block
// IDs and references as Obsidian writes them, tasks, journals by date, and
// no text lost on the way.
import { describe, expect, it } from "vitest";
import { type ImportSource, journalFormat, parseMarkdown, planLogseq } from "../src/index.ts";

const block = "64f1c2d3-0a1b-4c2d-8e3f-123456789abc";

const files: Record<string, string> = {
  "logseq/config.edn": '{:journal/page-title-format "MMM do, yyyy"}',
  "logseq/custom.css": ".x {}",
  "pages/Plan.md": [
    "tags:: project, [[work]]",
    "alias:: The plan",
    "status:: active",
    "",
    "- TODO Write the plan",
    "  id:: " + block,
    "- DONE Share it",
    "- LATER Review, on [[Oct 30th, 2026]]",
    "- NOW Keep going",
    "  owner:: me",
    "- ![photo](../assets/photo.png)",
    "- #[[big idea]] and #small",
    "- ```js",
    "  const x = ((not-a-ref));",
    "  ```",
    "",
  ].join("\n"),
  "pages/area___project.md":
    "- See ((" +
    block +
    ")) and ((00000000-0000-0000-0000-000000000000))\n- ![p](../assets/photo.png)\n",
  "pages/legacy%2Fpage.md": "- {{embed ((" + block + "))}}\n- {{embed [[Plan]]}}\n",
  "journals/2026_10_30.md": "- Met about [[Plan]]\n",
  "assets/photo.png": "PNG",
};

function source(entries: Record<string, string>): ImportSource {
  return {
    name: "graph",
    files: Object.keys(entries).map((path) => ({ path, size: entries[path]?.length ?? 0 })),
    readText: (path) => Promise.resolve(entries[path] ?? ""),
  };
}

const planned = planLogseq(source(files), "Logseq");
const noteAt = async (path: string) =>
  (await planned).notes.find((note) => note.path === path)?.text;

describe("planLogseq", () => {
  it("keeps the graph's folders, namespaces as folders, and journals by date; its settings stay behind", async () => {
    const plan = await planned;
    expect(plan.notes.map((note) => note.path).sort()).toEqual([
      "Logseq/journals/2026-10-30.md",
      "Logseq/pages/Plan.md",
      "Logseq/pages/area/project.md",
      "Logseq/pages/legacy/page.md",
    ]);
    expect(plan.files).toEqual([{ from: "assets/photo.png", to: "Logseq/assets/photo.png" }]);
  });

  it("makes page properties frontmatter, tasks checkboxes, block IDs Obsidian's, and keeps the rest", async () => {
    const text = (await noteAt("Logseq/pages/Plan.md")) ?? "";
    expect(parseMarkdown(text).properties).toEqual([
      { key: "tags", value: ["project", "work"] },
      { key: "aliases", value: ["The plan"] },
      { key: "status", value: "active" },
    ]);
    expect(text.slice(text.indexOf("---\n", 4) + 4)).toBe(
      [
        "",
        `- [ ] Write the plan ^${block}`,
        "- [x] Share it",
        "- [ ] Review, on [[Logseq/journals/2026-10-30|Oct 30th, 2026]]",
        "- NOW Keep going",
        "  owner:: me",
        "- ![photo](../assets/photo.png)",
        "- [[big idea]] and #small",
        "- ```js",
        "  const x = ((not-a-ref));",
        "  ```",
        "",
      ].join("\n"),
    );
  });

  it("makes references to blocks links and embeds, and finds files again from a namespace's folder", async () => {
    expect(await noteAt("Logseq/pages/area/project.md")).toBe(
      `- See [[Logseq/pages/Plan#^${block}]] and ((00000000-0000-0000-0000-000000000000))\n- ![p](../../assets/photo.png)\n`,
    );
    expect(await noteAt("Logseq/pages/legacy/page.md")).toBe(
      `- ![[Logseq/pages/Plan#^${block}]]\n- ![[Plan]]\n`,
    );
    expect((await planned).warnings).toEqual([
      "1 block references name blocks the graph does not have; they are as Logseq wrote them.",
    ]);
  });

  it("names a journal by its date, with the title Logseq gave it as its alias", async () => {
    const text = (await noteAt("Logseq/journals/2026-10-30.md")) ?? "";
    expect(parseMarkdown(text).properties).toEqual([{ key: "aliases", value: ["Oct 30th, 2026"] }]);
    expect(text).toContain("- Met about [[Plan]]\n");
  });

  it("loses no text: every word of every page reaches the vault", async () => {
    const out = (await planned).notes
      .map((note) => note.text)
      .join("\n")
      .toLowerCase();
    for (const [path, text] of Object.entries(files)) {
      if (!path.endsWith(".md")) continue;
      const words =
        text
          // Logseq's syntax, which becomes Obsidian's: task markers checkboxes, embeds `![[…]]`.
          .replace(/\b(TODO|DONE|LATER)\b/g, "")
          .replace(/\{\{embed /g, "")
          .toLowerCase()
          .match(/[\p{L}\p{N}]{2,}/gu) ?? [];
      for (const word of words) expect(out, `${word} from ${path}`).toContain(word);
    }
  });

  it("reads Logseq's journal title format in the tokens dates are written with", () => {
    expect(journalFormat("MMM do, yyyy")).toBe("MMM Do, YYYY");
    expect(journalFormat("EEEE, dd MMMM yyyy")).toBe("dddd, DD MMMM YYYY");
    expect(journalFormat("EEE d/MM/yy")).toBe("ddd D/MM/YY");
  });
});
