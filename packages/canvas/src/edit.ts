// Changes to a canvas, each a function from canvas to canvas, the old one
// as it was: nodes added, moved, resized, edited, colored and removed, and
// edges drawn, labelled and removed (ADR 0051). The app keeps the canvases
// they give for undoing and redoing, and writes the latest to the file.
import type { Canvas, CanvasColor, CanvasEdge, CanvasNode, Side, TextNode } from "./format.ts";
import { type Box, nodesInGroup } from "./geometry.ts";

/** The smallest a node is made, so it can still be seen and taken hold of. */
export const minNodeSize = 40;

function ids(canvas: Canvas): Set<string> {
  return new Set([...canvas.nodes.map((node) => node.id), ...canvas.edges.map((edge) => edge.id)]);
}

export { ids as canvasIds };

/** Adds a node on top of the others. */
export function addNode(canvas: Canvas, node: CanvasNode): Canvas {
  return {
    ...canvas,
    // A group goes beneath, so what it holds stays above it.
    nodes: node.type === "group" ? [node, ...canvas.nodes] : [...canvas.nodes, node],
  };
}

/** Changes a node's fields, as its text or its color; none set to undefined keeps a field. */
export function updateNode(
  canvas: Canvas,
  id: string,
  change: (node: CanvasNode) => CanvasNode,
): Canvas {
  return { ...canvas, nodes: canvas.nodes.map((node) => (node.id === id ? change(node) : node)) };
}

export function setText(canvas: Canvas, id: string, text: string): Canvas {
  return updateNode(canvas, id, (node) =>
    node.type === "text" ? ({ ...node, text } satisfies TextNode) : node,
  );
}

/** Sets a node's or an edge's color, or takes it off. */
export function setColor(canvas: Canvas, id: string, color: CanvasColor | undefined): Canvas {
  const paint = <Item extends { readonly color?: CanvasColor }>(item: Item): Item => {
    if (color !== undefined) return { ...item, color };
    const rest: { color?: CanvasColor } = { ...item };
    delete rest.color;
    return rest as Item;
  };
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => (node.id === id ? paint(node) : node)),
    edges: canvas.edges.map((edge) => (edge.id === id ? paint(edge) : edge)),
  };
}

/**
 * Moves nodes by a distance, and with each group the nodes wholly in it
 * where they were, as they move with it.
 */
export function moveNodes(
  canvas: Canvas,
  moving: readonly string[],
  dx: number,
  dy: number,
): Canvas {
  if (dx === 0 && dy === 0) return canvas;
  const moved = new Set(moving);
  for (const node of canvas.nodes) {
    if (node.type === "group" && moved.has(node.id)) {
      for (const inner of nodesInGroup(canvas.nodes, node)) moved.add(inner.id);
    }
  }
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) =>
      moved.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node,
    ),
  };
}

/** Gives a node a new place and size, no smaller than a node is made. */
export function resizeNode(canvas: Canvas, id: string, box: Box): Canvas {
  return updateNode(canvas, id, (node) => ({
    ...node,
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.max(minNodeSize, Math.round(box.width)),
    height: Math.max(minNodeSize, Math.round(box.height)),
  }));
}

/** Removes nodes and edges, and the edges that join a node removed. */
export function removeItems(canvas: Canvas, removing: readonly string[]): Canvas {
  const gone = new Set(removing);
  const nodes = canvas.nodes.filter((node) => !gone.has(node.id));
  const kept = new Set(nodes.map((node) => node.id));
  return {
    ...canvas,
    nodes,
    edges: canvas.edges.filter(
      (edge) => !gone.has(edge.id) && kept.has(edge.fromNode) && kept.has(edge.toNode),
    ),
  };
}

/**
 * Draws an edge from one node to another, an arrow at its end, unless the
 * two are one or an edge joins them that way already.
 */
export function connect(
  canvas: Canvas,
  edge: { readonly id: string; readonly from: string; readonly to: string },
  sides: { readonly fromSide?: Side; readonly toSide?: Side } = {},
): Canvas {
  if (edge.from === edge.to) return canvas;
  const has = (id: string) => canvas.nodes.some((node) => node.id === id);
  if (!has(edge.from) || !has(edge.to)) return canvas;
  if (canvas.edges.some((each) => each.fromNode === edge.from && each.toNode === edge.to)) {
    return canvas;
  }
  const drawn: CanvasEdge = {
    id: edge.id,
    fromNode: edge.from,
    toNode: edge.to,
    ...(sides.fromSide === undefined ? {} : { fromSide: sides.fromSide }),
    ...(sides.toSide === undefined ? {} : { toSide: sides.toSide }),
  };
  return { ...canvas, edges: [...canvas.edges, drawn] };
}

/** Labels an edge, or, with an empty label, takes its label off. */
export function setLabel(canvas: Canvas, id: string, label: string): Canvas {
  return {
    ...canvas,
    edges: canvas.edges.map((edge) => {
      if (edge.id !== id) return edge;
      if (label.trim() !== "") return { ...edge, label: label.trim() };
      const rest: { -readonly [Key in keyof CanvasEdge]: CanvasEdge[Key] } = { ...edge };
      delete rest.label;
      return rest;
    }),
  };
}

/** Moves a node to the top, drawn above the others, as one being worked on is. */
export function bringToFront(canvas: Canvas, id: string): Canvas {
  const node = canvas.nodes.find((each) => each.id === id);
  if (node === undefined || node.type === "group" || canvas.nodes.at(-1)?.id === id) return canvas;
  return { ...canvas, nodes: [...canvas.nodes.filter((each) => each.id !== id), node] };
}

/** The canvases before and after the present one, for undo and redo. */
export interface History {
  readonly past: readonly Canvas[];
  readonly present: Canvas;
  readonly future: readonly Canvas[];
}

/** How many changes undo goes back through. */
export const historyLimit = 100;

export function startHistory(canvas: Canvas): History {
  return { past: [], present: canvas, future: [] };
}

/** A change made: the present goes into the past, and what was undone is forgotten. */
export function record(history: History, next: Canvas): History {
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-historyLimit),
    present: next,
    future: [],
  };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
