// Where a canvas's things are: the point on each side of a node, the sides
// an edge joins when its file names none, the curve it draws, what lies
// under a point, the nodes a group holds, and the order the keyboard and
// screen readers go through them (ADR 0051).
import type { CanvasEdge, CanvasNode, Side } from "./format.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The middle of a node's side. */
export function sidePoint(box: Box, side: Side): Point {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height / 2 };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height / 2 };
  }
}

function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The sides facing each other, for an edge whose file names none: across, or up and down. */
export function facingSides(from: Box, to: Box): { readonly from: Side; readonly to: Side } {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  }
  return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}

/** Which way a side faces, as a unit step. */
function outward(side: Side): Point {
  return {
    top: { x: 0, y: -1 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[side];
}

export interface EdgeGeometry {
  readonly start: Point;
  readonly end: Point;
  readonly fromSide: Side;
  readonly toSide: Side;
  /** A cubic Bézier curve, as SVG's `d` has it. */
  readonly path: string;
  /** The curve's middle, where its label goes. */
  readonly middle: Point;
  /** Which way the curve arrives at its end, for its arrow, in radians. */
  readonly endAngle: number;
  /** Which way it leaves its start, backwards, for an arrow there. */
  readonly startAngle: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * An edge's curve: from the middle of one side to the middle of the other,
 * leaving and arriving square to them, further out the longer it is, as
 * Obsidian draws them. Undefined when a node it joins is not given.
 */
export function edgeGeometry(
  edge: CanvasEdge,
  node: (id: string) => Box | undefined,
): EdgeGeometry | undefined {
  const from = node(edge.fromNode);
  const to = node(edge.toNode);
  if (from === undefined || to === undefined) return undefined;
  const facing = facingSides(from, to);
  const fromSide = edge.fromSide ?? facing.from;
  const toSide = edge.toSide ?? facing.to;
  const start = sidePoint(from, fromSide);
  const end = sidePoint(to, toSide);
  const reach = Math.max(40, Math.min(240, Math.hypot(end.x - start.x, end.y - start.y) / 2));
  const out = outward(fromSide);
  const back = outward(toSide);
  const c1 = { x: start.x + out.x * reach, y: start.y + out.y * reach };
  const c2 = { x: end.x + back.x * reach, y: end.y + back.y * reach };
  // The point halfway along t, which a cubic curve has at t = 0.5.
  const middle = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  };
  const path = [
    `M ${String(round(start.x))} ${String(round(start.y))}`,
    `C ${String(round(c1.x))} ${String(round(c1.y))}, ${String(round(c2.x))} ${String(round(c2.y))}, ${String(round(end.x))} ${String(round(end.y))}`,
  ].join(" ");
  return {
    start,
    end,
    fromSide,
    toSide,
    path,
    middle,
    endAngle: Math.atan2(-back.y, -back.x),
    startAngle: Math.atan2(-out.y, -out.x),
  };
}

/** The box all the nodes are in; undefined for none. */
export function canvasBounds(nodes: readonly Box[]): Box | undefined {
  if (nodes.length === 0) return undefined;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of nodes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function contains(box: Box, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** Whether one box lies wholly in another. */
export function within(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The node under a point: the topmost, a group only where no other node is. */
export function nodeAt(nodes: readonly CanvasNode[], point: Point): CanvasNode | undefined {
  let group: CanvasNode | undefined;
  for (let at = nodes.length - 1; at >= 0; at--) {
    const node = nodes[at];
    if (node === undefined || !contains(node, point)) continue;
    if (node.type !== "group") return node;
    group ??= node;
  }
  return group;
}

/** The nodes a group holds, those wholly in it, which move with it. */
export function nodesInGroup(nodes: readonly CanvasNode[], group: CanvasNode): CanvasNode[] {
  return nodes.filter((node) => node.id !== group.id && within(node, group));
}

/**
 * The nodes in the order they are read: top to bottom, and along a row
 * from the start, a row being the nodes whose tops are within half the
 * shortest's height of each other. Right to left, rows read from the right.
 */
export function readingOrder(nodes: readonly CanvasNode[], rtl = false): CanvasNode[] {
  const sorted = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: CanvasNode[][] = [];
  for (const node of sorted) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    if (
      row !== undefined &&
      first !== undefined &&
      node.y - first.y < Math.min(first.height, node.height) / 2
    ) {
      row.push(node);
    } else rows.push([node]);
  }
  return rows.flatMap((row) =>
    row.sort((a, b) => (rtl ? b.x + b.width - (a.x + a.width) : a.x - b.x)),
  );
}

/** A number on the grid things snap to. */
export function snap(value: number, grid = 20): number {
  return Math.round(value / grid) * grid;
}
