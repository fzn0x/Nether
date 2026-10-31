// The graph view's data: notes and the links between them, the whole
// vault's or around one note, kept to a filter.
import type { NoteId } from "@nether/core";
import { parseMarkdown } from "@nether/markdown";
import { describe, expect, it } from "vitest";
import { LinkGraph, graphData, indexNote } from "../src/index.ts";

function vault(files: Readonly<Record<string, string>>): LinkGraph {
  const graph = new LinkGraph();
  graph.setMany(
    Object.entries(files).map(([path, markdown]) => {
      const parsed = parseMarkdown(markdown);
      return { id: path as NoteId, path, index: indexNote(parsed, parsed.writtenIds) };
    }),
  );
  return graph;
}

const graph = vault({
  "Home.md":
    "[[Projects/Roadmap]] and [[Roadmap#Next|the next steps]] and [[Missing]] and [[#Top]]",
  "Projects/Roadmap.md": "---\ntags: [project]\n---\n[[Ideas]] and [[Home]] ^r",
  "Ideas.md": "![[Archive/Old]]",
  "Archive/Old.md": "Old.",
  "Lonely.md": "No links.",
});

const names = (data: ReturnType<typeof graphData>) => ({
  nodes: data.nodes.map((node) => node.title).sort(),
  edges: data.edges.map((edge) => `${edge.source} > ${edge.target}`).sort(),
});

describe("graphData", () => {
  it("draws each note, and a link once from one note to another", () => {
    expect(names(graphData(graph))).toEqual({
      nodes: ["Home", "Ideas", "Lonely", "Old", "Roadmap"],
      edges: [
        "Home.md > Projects/Roadmap.md",
        "Ideas.md > Archive/Old.md",
        "Projects/Roadmap.md > Home.md",
        "Projects/Roadmap.md > Ideas.md",
      ],
    });
  });

  it("counts each note's edges, in and out", () => {
    const { degrees } = graphData(graph);
    expect(Object.fromEntries(degrees)).toEqual({
      "Home.md": 2,
      "Projects/Roadmap.md": 3,
      "Ideas.md": 2,
      "Archive/Old.md": 1,
    });
  });

  it("keeps the notes a filter keeps, and only the links among them", () => {
    const data = graphData(graph, { keep: (note) => !note.path.startsWith("Archive/") });
    expect(names(data).edges).not.toContain("Ideas.md > Archive/Old.md");
    expect(names(data).nodes).toEqual(["Home", "Ideas", "Lonely", "Roadmap"]);
  });

  it("leaves out notes without links when asked", () => {
    expect(names(graphData(graph, { orphans: false })).nodes).not.toContain("Lonely");
  });

  it("draws the notes around one, links either way, as deep as asked", () => {
    const around = (depth: number) =>
      names(graphData(graph, { around: { note: "Ideas.md" as NoteId, depth } })).nodes;
    expect(around(0)).toEqual(["Ideas"]);
    expect(around(1)).toEqual(["Ideas", "Old", "Roadmap"]);
    expect(around(2)).toEqual(["Home", "Ideas", "Old", "Roadmap"]);
  });

  it("keeps the note it is around whatever the filter, and goes only through what it keeps", () => {
    const data = graphData(graph, {
      around: { note: "Home.md" as NoteId, depth: 3 },
      keep: (note) => note.title !== "Home" && note.title !== "Ideas",
    });
    expect(names(data)).toEqual({
      nodes: ["Home", "Roadmap"],
      edges: ["Home.md > Projects/Roadmap.md", "Projects/Roadmap.md > Home.md"],
    });
    // A note that has no links around it is still drawn.
    expect(
      names(graphData(graph, { around: { note: "Lonely.md" as NoteId, depth: 2 }, orphans: false }))
        .nodes,
    ).toEqual(["Lonely"]);
  });
});
