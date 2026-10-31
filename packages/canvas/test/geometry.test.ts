// A canvas's geometry: sides and the sides edges join, their curves, the
// bounds of nodes, what is under a point, what a group holds, and the
// order nodes are read in.
import { describe, expect, it } from "vitest";
import {
  type Box,
  type CanvasNode,
  canvasBounds,
  edgeGeometry,
  facingSides,
  nodeAt,
  nodesInGroup,
  readingOrder,
  sidePoint,
  snap,
} from "../src/index.ts";

const box: Box = { x: 0, y: 0, width: 100, height: 50 };

function text(id: string, x: number, y: number, width = 100, height = 50): CanvasNode {
  return { id, type: "text", text: id, x, y, width, height };
}

describe("sides", () => {
  it("gives the middle of each side", () => {
    expect(sidePoint(box, "top")).toEqual({ x: 50, y: 0 });
    expect(sidePoint(box, "right")).toEqual({ x: 100, y: 25 });
    expect(sidePoint(box, "bottom")).toEqual({ x: 50, y: 50 });
    expect(sidePoint(box, "left")).toEqual({ x: 0, y: 25 });
  });

  it("joins the sides that face each other", () => {
    const at = (x: number, y: number): Box => ({ ...box, x, y });
    expect(facingSides(box, at(300, 10))).toEqual({ from: "right", to: "left" });
    expect(facingSides(box, at(-300, 10))).toEqual({ from: "left", to: "right" });
    expect(facingSides(box, at(10, 300))).toEqual({ from: "bottom", to: "top" });
    expect(facingSides(box, at(10, -300))).toEqual({ from: "top", to: "bottom" });
  });
});

describe("edgeGeometry", () => {
  const nodes = new Map<string, Box>([
    ["a", box],
    ["b", { x: 400, y: 0, width: 100, height: 50 }],
  ]);
  const find = (id: string) => nodes.get(id);

  it("curves from side to side, square to each, its arrow pointing in", () => {
    const geometry = edgeGeometry({ id: "e", fromNode: "a", toNode: "b" }, find);
    expect(geometry).toMatchObject({
      start: { x: 100, y: 25 },
      end: { x: 400, y: 25 },
      fromSide: "right",
      toSide: "left",
      middle: { x: 250, y: 25 },
    });
    expect(geometry?.path).toBe("M 100 25 C 250 25, 250 25, 400 25");
    // Arriving from the left, heading right; leaving rightwards, so its start arrow points left.
    expect(geometry?.endAngle).toBeCloseTo(0);
    expect(Math.abs(geometry?.startAngle ?? 0)).toBeCloseTo(Math.PI);
  });

  it("keeps the sides the file names, and reaches out at least a little", () => {
    const geometry = edgeGeometry(
      { id: "e", fromNode: "a", fromSide: "bottom", toNode: "a", toSide: "top" },
      find,
    );
    expect(geometry?.path).toBe("M 50 50 C 50 90, 50 -40, 50 0");
    expect(edgeGeometry({ id: "e", fromNode: "a", toNode: "gone" }, find)).toBeUndefined();
  });
});

describe("where nodes are", () => {
  const group: CanvasNode = { id: "g", type: "group", x: -50, y: -50, width: 400, height: 300 };
  const inside = text("in", 0, 0);
  const outside = text("out", 500, 0);
  const nodes = [group, inside, outside];

  it("bounds them all, or none", () => {
    expect(canvasBounds(nodes)).toEqual({ x: -50, y: -50, width: 650, height: 300 });
    expect(canvasBounds([])).toBeUndefined();
  });

  it("finds the node under a point, a group where no other is", () => {
    expect(nodeAt(nodes, { x: 10, y: 10 })?.id).toBe("in");
    expect(nodeAt(nodes, { x: 300, y: 200 })?.id).toBe("g");
    expect(nodeAt(nodes, { x: 1000, y: 1000 })).toBeUndefined();
  });

  it("gives what a group holds", () => {
    expect(nodesInGroup(nodes, group).map((node) => node.id)).toEqual(["in"]);
  });

  it("reads nodes by rows, top to bottom, from the start", () => {
    const order = [text("b", 200, 4), text("c", 0, 200), text("a", 0, 0), text("d", 200, 210)];
    expect(readingOrder(order).map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
    expect(readingOrder(order, true).map((node) => node.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("snaps to the grid", () => {
    expect(snap(29)).toBe(20);
    expect(snap(31)).toBe(40);
    expect(snap(-11)).toBe(-20);
    expect(snap(7, 5)).toBe(5);
  });
});
