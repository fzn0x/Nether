// Reading and writing JSON Canvas files as Obsidian keeps them: every kind
// of node and edge, fields of other apps kept, what cannot be used left out
// and said, and the file written back as Obsidian writes it.
import { describe, expect, it } from "vitest";
import { type Canvas, emptyCanvas, newCanvasId, readCanvas, writeCanvas } from "../src/index.ts";

/** A canvas as Obsidian writes one: tab-indented, a node or edge a line. */
const obsidian = `{
	"nodes":[
		{"id":"a1b2c3d4e5f60718","type":"group","label":"Plan","x":-400,"y":-300,"width":900,"height":600,"color":"4"},
		{"id":"0123456789abcdef","type":"text","text":"# Launch\\n\\nShip **it**","x":-360,"y":-240,"width":250,"height":140},
		{"id":"fedcba9876543210","type":"file","file":"Projects/Roadmap.md","subpath":"#Q2","x":40,"y":-240,"width":400,"height":400},
		{"id":"1111222233334444","type":"link","url":"https://jsoncanvas.org","x":-360,"y":0,"width":400,"height":240,"color":"#ff7a50","styleAttributes":{"shape":"pill"}}
	],
	"edges":[
		{"id":"5555666677778888","fromNode":"0123456789abcdef","fromSide":"right","toNode":"fedcba9876543210","toSide":"left","label":"leads to"},
		{"id":"9999aaaabbbbcccc","fromNode":"1111222233334444","fromSide":"top","fromEnd":"arrow","toNode":"0123456789abcdef","toSide":"bottom","toEnd":"none","color":"1"}
	],
	"metadata":{"version":"1.0-1.0"}
}`;

describe("readCanvas", () => {
  it("reads every kind of node and edge, keeping what it does not know", () => {
    const { canvas, problems } = readCanvas(obsidian);
    expect(problems).toEqual([]);
    expect(canvas.nodes.map((node) => node.type)).toEqual(["group", "text", "file", "link"]);
    expect(canvas.nodes[2]).toEqual({
      id: "fedcba9876543210",
      type: "file",
      file: "Projects/Roadmap.md",
      subpath: "#Q2",
      x: 40,
      y: -240,
      width: 400,
      height: 400,
    });
    expect(canvas.nodes[3]).toMatchObject({
      color: "#ff7a50",
      extra: { styleAttributes: { shape: "pill" } },
    });
    expect(canvas.edges[1]).toMatchObject({ fromEnd: "arrow", toEnd: "none", color: "1" });
    expect(canvas.extra).toEqual({ metadata: { version: "1.0-1.0" } });
  });

  it("writes the file back as Obsidian wrote it", () => {
    expect(writeCanvas(readCanvas(obsidian).canvas)).toBe(obsidian);
  });

  it("reads an empty file as an empty canvas, and refuses what is not a canvas", () => {
    expect(readCanvas("  \n")).toEqual({ canvas: emptyCanvas, problems: [] });
    expect(readCanvas("{}").canvas).toEqual({ nodes: [], edges: [] });
    expect(() => readCanvas("{nodes")).toThrow("not JSON");
    expect(() => readCanvas("[1, 2]")).toThrow("not a JSON Canvas");
  });

  it("leaves out what it cannot use, and says why", () => {
    const { canvas, problems } = readCanvas(
      JSON.stringify({
        nodes: [
          "loose",
          { type: "text", x: 0, y: 0, width: 1, height: 1 },
          { id: "a", type: "text", x: 0, y: 0 },
          { id: "b", type: "shape", x: 0, y: 0, width: 1, height: 1 },
          { id: "c", type: "file", x: 0, y: 0, width: 1, height: 1 },
          { id: "d", type: "link", x: 0, y: 0, width: 1, height: 1 },
          { id: "e", type: "text", x: 0.6, y: 0, width: -5, height: 20, color: "red" },
          { id: "e", type: "text", text: "again", x: 0, y: 0, width: 1, height: 1 },
          { id: "f", type: "group", x: 0, y: 0, width: 9, height: 9, backgroundStyle: "tile" },
        ],
        edges: [
          7,
          { fromNode: "e", toNode: "f" },
          { id: "g", fromNode: "e" },
          { id: "h", fromNode: "e", toNode: "gone" },
          { id: "i", fromNode: "e", toNode: "f", fromSide: "middle", toEnd: "dot" },
          { id: "i", fromNode: "f", toNode: "e" },
        ],
      }),
    );
    expect(problems).toEqual([
      "Node 1 is not an object.",
      "Node 2 has no ID.",
      "Node a has no place or size.",
      'Node b is of a type Nether does not know, "shape".',
      "Node c names no file.",
      "Node d has no address.",
      "Node e is there twice; the second is left out.",
      "Edge 1 is not an object.",
      "Edge 2 has no ID.",
      "Edge g does not name the nodes it joins.",
      "Edge h joins a node the canvas does not have.",
      "Edge i is there twice; the second is left out.",
    ]);
    // Fractions rounded, sizes at least one, an unknown color, side and end left out.
    expect(canvas.nodes).toEqual([
      { id: "e", type: "text", text: "", x: 1, y: 0, width: 1, height: 20 },
      { id: "f", type: "group", x: 0, y: 0, width: 9, height: 9 },
    ]);
    expect(canvas.edges).toEqual([{ id: "i", fromNode: "e", toNode: "f" }]);
  });
});

describe("writeCanvas", () => {
  it("writes an empty canvas, and nodes' fields in the specification's order", () => {
    expect(writeCanvas(emptyCanvas)).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
    const canvas: Canvas = {
      nodes: [
        {
          type: "group",
          id: "g",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          backgroundStyle: "ratio",
          background: "bg.png",
        },
      ],
      edges: [],
    };
    expect(writeCanvas(canvas)).toContain(
      '{"id":"g","type":"group","background":"bg.png","backgroundStyle":"ratio","x":0,"y":0,"width":10,"height":10}',
    );
  });
});

describe("newCanvasId", () => {
  it("gives 16 hexadecimal digits that are not taken", () => {
    const zero = () => 0;
    expect(newCanvasId(new Set(), zero)).toBe("0000000000000000");
    let calls = 0;
    // The first try is taken, so it tries again.
    const id = newCanvasId(new Set(["0000000000000000"]), () => (calls++ < 16 ? 0 : 0.99));
    expect(id).toBe("ffffffffffffffff");
    expect(newCanvasId(new Set())).toMatch(/^[0-9a-f]{16}$/);
  });
});
