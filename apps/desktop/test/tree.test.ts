import type { NoteId } from "@nether/core";
import type { NoteEntry } from "@nether/storage";
import { describe, expect, it } from "vitest";
import { type TreeNode, folderTree, pageTree, pathTo, visibleRows } from "../src/tree.ts";

function notes(...paths: string[]): NoteEntry[] {
  return paths.map((path) => ({
    id: path as NoteId,
    path,
    title: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
    size: 0,
    modified: 0,
  }));
}

/** A tree as nested names: folders end with `/`. */
function shape(nodes: readonly TreeNode[]): unknown[] {
  return nodes.map((node) => {
    const name =
      node.kind === "folder"
        ? `${node.name}/`
        : node.kind === "file"
          ? `${node.name} (canvas)`
          : node.note.title;
    return node.children.length === 0 ? name : { [name]: shape(node.children) };
  });
}

const vault = notes(
  "Welcome.md",
  "Projects.md",
  "Projects/Plan.md",
  "Projects/Plan/Step 10.md",
  "Projects/Plan/Step 9.md",
  "Projects/Ideas.md",
  "Archive/Old.md",
  "Daily/2026-11-06.md",
  "Daily.md",
);

describe("folderTree", () => {
  it("shows folders, then notes, at each level, as a file explorer sorts them", () => {
    expect(shape(folderTree(vault))).toEqual([
      { "Archive/": ["Old"] },
      { "Daily/": ["2026-11-06"] },
      {
        "Projects/": [{ "Plan/": ["Step 9", "Step 10"] }, "Ideas", "Plan"],
      },
      "Daily",
      "Projects",
      "Welcome",
    ]);
  });
});

describe("canvases in the trees", () => {
  it("show beside the notes of their folder, sorted with them, and in the page tree too", () => {
    const files = ["Projects/Board.canvas", "Map.canvas"];
    expect(shape(folderTree(notes("Projects/Plan.md", "Welcome.md"), [], files))).toEqual([
      { "Projects/": ["Board (canvas)", "Plan"] },
      "Map (canvas)",
      "Welcome",
    ]);
    expect(shape(pageTree(notes("Projects.md"), [], files))).toEqual([
      "Map (canvas)",
      { Projects: ["Board (canvas)"] },
    ]);
    expect(pathTo(folderTree([], [], files), "c:Projects/Board.canvas")).toEqual(["f:Projects"]);
  });
});

describe("pageTree", () => {
  it("puts a folder's notes under the note beside it with its name, and keeps other folders", () => {
    expect(shape(pageTree(vault))).toEqual([
      { "Archive/": ["Old"] },
      { Daily: ["2026-11-06"] },
      { Projects: ["Ideas", { Plan: ["Step 9", "Step 10"] }] },
      "Welcome",
    ]);
  });

  it("matches a page to its folder whatever the letters' case", () => {
    expect(shape(pageTree(notes("plan.md", "Plan/Step.md")))).toEqual([{ plan: ["Step"] }]);
  });
});

describe("visibleRows", () => {
  it("shows the children of expanded nodes only, with their depth and place", () => {
    const tree = pageTree(vault);
    const rows = visibleRows(tree, new Set(["n:Projects.md", "n:Projects/Plan.md"]));
    expect(
      rows.map((row) => [
        row.node.kind === "note" ? row.node.note.title : row.node.name,
        row.depth,
        row.expanded,
        `${String(row.position + 1)}/${String(row.siblings)}`,
      ]),
    ).toEqual([
      ["Archive", 0, false, "1/4"],
      ["Daily", 0, false, "2/4"],
      ["Projects", 0, true, "3/4"],
      ["Ideas", 1, false, "1/2"],
      ["Plan", 1, true, "2/2"],
      ["Step 9", 2, false, "1/2"],
      ["Step 10", 2, false, "2/2"],
      ["Welcome", 0, false, "4/4"],
    ]);
    expect(rows[5]?.parent).toBe("n:Projects/Plan.md");
  });
});

describe("pathTo", () => {
  it("gives the nodes a note is in, to show it", () => {
    expect(pathTo(folderTree(vault), "Projects/Plan/Step 9.md")).toEqual([
      "f:Projects",
      "f:Projects/Plan",
    ]);
    expect(pathTo(pageTree(vault), "Projects/Plan/Step 9.md")).toEqual([
      "n:Projects.md",
      "n:Projects/Plan.md",
    ]);
    expect(pathTo(pageTree(vault), "Welcome.md")).toEqual([]);
    expect(pathTo(pageTree(vault), "Gone.md")).toEqual([]);
  });
});
