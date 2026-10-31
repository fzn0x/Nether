// Changes to a canvas: each gives a new canvas and leaves the old one as it
// was; groups carry what they hold; edges go with the nodes they join; and
// undo and redo walk the canvases made.
import { describe, expect, it } from "vitest";
import {
  type Canvas,
  type CanvasNode,
  addNode,
  bringToFront,
  canvasIds,
  connect,
  historyLimit,
  moveNodes,
  record,
  redo,
  removeItems,
  resizeNode,
  setColor,
  setLabel,
  setText,
  startHistory,
  undo,
  updateNode,
} from "../src/index.ts";

function text(id: string, x: number, y: number): CanvasNode {
  return { id, type: "text", text: id, x, y, width: 100, height: 50 };
}

const group: CanvasNode = {
  id: "g",
  type: "group",
  label: "G",
  x: 0,
  y: 0,
  width: 400,
  height: 300,
};
const base: Canvas = {
  nodes: [group, text("a", 20, 20), text("b", 600, 20)],
  edges: [{ id: "e", fromNode: "a", toNode: "b", label: "to b", color: "1" }],
};

describe("changing nodes", () => {
  it("adds a node on top, and a group beneath", () => {
    expect(addNode(base, text("c", 0, 0)).nodes.map((node) => node.id)).toEqual([
      "g",
      "a",
      "b",
      "c",
    ]);
    const second: CanvasNode = { ...group, id: "h" };
    expect(addNode(base, second).nodes[0]?.id).toBe("h");
    expect(base.nodes).toHaveLength(3);
  });

  it("sets text, only on a text node, and colors, or takes them off", () => {
    expect(setText(base, "a", "hello").nodes[1]).toMatchObject({ text: "hello" });
    expect(setText(base, "g", "no").nodes[0]).toBe(group);
    expect(setColor(base, "a", "4").nodes[1]?.color).toBe("4");
    expect(setColor(base, "e", undefined).edges[0]).not.toHaveProperty("color");
    expect(updateNode(base, "gone", () => text("x", 0, 0))).toEqual(base);
  });

  it("moves nodes, a group with what it holds", () => {
    const moved = moveNodes(base, ["g"], 10, -5);
    expect(moved.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
      ["g", 10, -5],
      ["a", 30, 15],
      ["b", 600, 20],
    ]);
    expect(moveNodes(base, ["b"], 0, 0)).toBe(base);
  });

  it("resizes a node, no smaller than it can be held", () => {
    expect(resizeNode(base, "a", { x: 1.4, y: 2, width: 10, height: 99.6 }).nodes[1]).toMatchObject(
      {
        x: 1,
        y: 2,
        width: 40,
        height: 100,
      },
    );
  });

  it("removes nodes with their edges, and edges alone", () => {
    expect(removeItems(base, ["b"])).toMatchObject({ edges: [] });
    const edgeless = removeItems(base, ["e"]);
    expect(edgeless.nodes).toHaveLength(3);
    expect(edgeless.edges).toEqual([]);
  });

  it("brings a node to the front, but not a group", () => {
    expect(bringToFront(base, "a").nodes.map((node) => node.id)).toEqual(["g", "b", "a"]);
    expect(bringToFront(base, "b")).toBe(base);
    expect(bringToFront(base, "g")).toBe(base);
    expect(bringToFront(base, "gone")).toBe(base);
  });

  it("knows every ID the canvas uses", () => {
    expect([...canvasIds(base)].sort()).toEqual(["a", "b", "e", "g"]);
  });
});

describe("edges", () => {
  it("connects two nodes once, with the sides asked for", () => {
    const joined = connect(
      base,
      { id: "f", from: "b", to: "a" },
      { fromSide: "left", toSide: "right" },
    );
    expect(joined.edges[1]).toEqual({
      id: "f",
      fromNode: "b",
      toNode: "a",
      fromSide: "left",
      toSide: "right",
    });
    expect(connect(base, { id: "f", from: "a", to: "a" })).toBe(base);
    expect(connect(base, { id: "f", from: "a", to: "gone" })).toBe(base);
    expect(connect(base, { id: "f", from: "a", to: "b" })).toBe(base);
    expect(connect(base, { id: "f", from: "g", to: "b" }).edges[1]).toEqual({
      id: "f",
      fromNode: "g",
      toNode: "b",
    });
  });

  it("labels an edge, or takes its label off", () => {
    expect(setLabel(base, "e", "  next  ").edges[0]?.label).toBe("next");
    expect(setLabel(base, "e", " ").edges[0]).not.toHaveProperty("label");
    expect(setLabel(base, "gone", "x")).toEqual(base);
  });
});

describe("history", () => {
  it("undoes and redoes, and a change forgets what was undone", () => {
    const a = startHistory(base);
    const changed = setText(base, "a", "one");
    const b = record(a, changed);
    expect(record(b, changed)).toBe(b);
    expect(undo(b).present).toBe(base);
    expect(redo(undo(b)).present).toBe(changed);
    expect(undo(a)).toBe(a);
    expect(redo(b)).toBe(b);
    const other = record(undo(b), setText(base, "a", "two"));
    expect(other.future).toEqual([]);
  });

  it("keeps a hundred changes back", () => {
    let history = startHistory(base);
    for (let n = 0; n <= historyLimit + 5; n++)
      history = record(history, setText(base, "a", String(n)));
    expect(history.past).toHaveLength(historyLimit);
  });
});
