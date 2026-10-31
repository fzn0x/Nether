// A Notion export: names without IDs, pages and their subpages, databases
// with their rows, links made wiki links, and no text lost on the way.
import { describe, expect, it } from "vitest";
import {
  type ImportSource,
  notionStem,
  parseMarkdown,
  planNotion,
  readNotionDate,
} from "../src/index.ts";

const id = (digit: string) => digit.repeat(32);
const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const workspace = `Workspace ${id("1")}`;
const plan = `Plan Q3 Q4 ${id("3")}`;
const projects = `Projects ${id("2")}`;

const files: Record<string, string> = {
  [`${workspace}.md`]: [
    "# Workspace",
    "",
    `Welcome to the [Projects](${enc(`${projects}.csv`)}) and our [Plan](${enc(`${workspace}/${plan}.md`)}).`,
    "",
    `![Diagram](${enc(`${workspace}/diagram.png`)})`,
    "",
    "> A quote, with **bold** text.",
    "",
    "| Col | Link |",
    "| --- | --- |",
    `| a | [Plan](${enc(`${workspace}/${plan}.md`)}) |`,
    "",
    `See [the web](https://example.com), [a heading](${enc(`${workspace}/${plan}.md`)}#Steps) and [missing](${enc(`Gone ${id("9")}.md`)}).`,
    "",
    "`[code](Not%20a%20link.md)`",
    "",
  ].join("\n"),
  [`${workspace}/${plan}.md`]: [
    "# Plan: Q3/Q4",
    "",
    "Steps:",
    "",
    "- [ ] Write it",
    "- [x] Ship it",
    "",
    `Back to [Workspace](../${enc(`${workspace}.md`)}).`,
    "",
  ].join("\n"),
  [`${workspace}/diagram.png`]: "PNG",
  [`${projects}.csv`]: "Name,Status\nLaunch,In progress\nSite,Done\nOrphan,Todo\n",
  [`${projects}_all.csv`]: [
    "Name,Status,Points,Due,Done,Link,Tags",
    'Launch,In progress,3,"October 30, 2026",Yes,https://example.com,"web, launch"',
    'Site,Done,5,"November 2, 2026 3:45 PM",No,,',
    "Orphan,Todo,,,No,,",
  ].join("\n"),
  [`${projects}/Launch ${id("4")}.md`]: [
    "# Launch",
    "",
    "Status: In progress",
    "Points: 3",
    "Due: October 30, 2026",
    "Done: Yes",
    "Link: https://example.com",
    "Tags: web, launch",
    "",
    `The launch notes, with a [link to Site](${enc(`Site ${id("5")}.md`)}).`,
    "Note: this line is the page's own.",
    "",
  ].join("\n"),
  [`${projects}/Site ${id("5")}.md`]: [
    "# Site",
    "",
    "Status: Done",
    "Points: 5",
    "Due: November 2, 2026 3:45 PM",
    "Done: No",
    "",
    "Site notes.",
    "",
  ].join("\n"),
};

function source(entries: Record<string, string>): ImportSource {
  return {
    name: "Export",
    files: Object.keys(entries).map((path) => ({ path, size: entries[path]?.length ?? 0 })),
    readText: (path) => Promise.resolve(entries[path] ?? ""),
  };
}

const planned = planNotion(source(files), "Export");
const noteAt = async (path: string) =>
  (await planned).notes.find((note) => note.path === path)?.text;

describe("planNotion", () => {
  it("names every page and folder without its ID, a page's subpages in the folder beside it", async () => {
    const { notes, files: copied } = await planned;
    expect(notes.map((note) => note.path).sort()).toEqual([
      "Export/Projects.md",
      "Export/Projects/Launch.md",
      "Export/Projects/Orphan.md",
      "Export/Projects/Site.md",
      "Export/Workspace.md",
      "Export/Workspace/Plan Q3 Q4.md",
    ]);
    expect(copied).toEqual([
      { from: `${workspace}/diagram.png`, to: "Export/Workspace/diagram.png" },
    ]);
  });

  it("makes links to pages, databases and files wiki links, and leaves the rest as written", async () => {
    expect(await noteAt("Export/Workspace.md")).toBe(
      [
        "Welcome to the [[Export/Projects]] and our [[Export/Workspace/Plan Q3 Q4|Plan]].",
        "",
        "![[Export/Workspace/diagram.png|Diagram]]",
        "",
        "> A quote, with **bold** text.",
        "",
        "| Col | Link |",
        "| --- | --- |",
        "| a | [[Export/Workspace/Plan Q3 Q4\\|Plan]] |",
        "",
        `See [the web](https://example.com), [[Export/Workspace/Plan Q3 Q4#Steps|a heading]] and [missing](${enc(`Gone ${id("9")}.md`)}).`,
        "",
        "`[code](Not%20a%20link.md)`",
        "",
      ].join("\n"),
    );
    expect((await planned).warnings).toEqual([
      "1 links name pages or files the export does not have; they are as Notion wrote them.",
    ]);
  });

  it("keeps a title its file's name cannot hold as the note's alias", async () => {
    const text = (await noteAt("Export/Workspace/Plan Q3 Q4.md")) ?? "";
    expect(parseMarkdown(text).properties).toEqual([{ key: "aliases", value: ["Plan: Q3/Q4"] }]);
    expect(text).toContain("Back to [[Export/Workspace]].");
  });

  it("makes a database of its fullest table, typing each column, and a row's lines its properties", async () => {
    expect(parseMarkdown((await noteAt("Export/Projects.md")) ?? "").properties).toEqual([
      {
        key: "database",
        value: {
          properties: [
            { key: "Status", type: "text" },
            { key: "Points", type: "number" },
            { key: "Due", type: "date" },
            { key: "Done", type: "checkbox" },
            { key: "Link", type: "url" },
            { key: "Tags", type: "text" },
          ],
          views: [
            {
              name: "Table",
              layout: "table",
              visible: ["Status", "Points", "Due", "Done", "Link", "Tags"],
            },
          ],
        },
      },
    ]);
    const launch = parseMarkdown((await noteAt("Export/Projects/Launch.md")) ?? "");
    expect(launch.properties).toEqual([
      { key: "Status", value: "In progress" },
      { key: "Points", value: 3 },
      { key: "Due", value: "2026-10-30" },
      { key: "Done", value: true },
      { key: "Link", value: "https://example.com" },
      { key: "Tags", value: "web, launch" },
    ]);
    expect(await noteAt("Export/Projects/Launch.md")).toMatch(
      /\n---\nThe launch notes, with a \[\[Export\/Projects\/Site\|link to Site\]\]\.\nNote: this line is the page's own\.\n$/,
    );
    expect(
      parseMarkdown((await noteAt("Export/Projects/Site.md")) ?? "").properties,
    ).toContainEqual({ key: "Due", value: "2026-11-02T15:45" });
    // A line of the table with no page of its own.
    expect(parseMarkdown((await noteAt("Export/Projects/Orphan.md")) ?? "").properties).toEqual([
      { key: "Status", value: "Todo" },
      { key: "Done", value: false },
    ]);
  });

  it("loses no text: every word of every page reaches the vault", async () => {
    const out = (await planned).notes
      .map((note) => note.text)
      .join("\n")
      .toLowerCase();
    const words = (text: string) =>
      text
        // Link addresses, which become where the links go, and dates and checkboxes,
        // which become ISO dates and true or false: the test above checks those.
        .replace(/\]\([^)]*\)/g, "]")
        .replace(/[A-Z][a-z]+ \d{1,2}, \d{4}( \d{1,2}:\d{2} [AP]M)?/g, "")
        .replace(/: (Yes|No)$/gm, ":")
        .toLowerCase()
        .match(/[\p{L}\p{N}]{2,}/gu) ?? [];
    for (const [path, text] of Object.entries(files)) {
      if (!path.endsWith(".md")) continue;
      for (const word of words(text)) expect(out, `${word} from ${path}`).toContain(word);
    }
  });
});

describe("Notion's names and dates", () => {
  it("reads a name without its ID, and a date as rows write dates", () => {
    expect(notionStem(`Plan ${id("a")}.md`)).toBe("Plan");
    expect(notionStem(`Tasks ${id("b")}_all.csv`)).toBe("Tasks");
    expect(notionStem(`Release v1.2 ${id("c")}`, true)).toBe("Release v1.2");
    expect(notionStem("Plain.md")).toBe("Plain");
    expect(readNotionDate("October 30, 2026")).toBe("2026-10-30");
    expect(readNotionDate("March 3, 2026 12:05 AM")).toBe("2026-03-03T00:05");
    expect(readNotionDate("March 3, 2026 12:05 PM")).toBe("2026-03-03T12:05");
    expect(readNotionDate("Smarch 3, 2026")).toBeUndefined();
    expect(readNotionDate("2026-10-30")).toBeUndefined();
  });
});
