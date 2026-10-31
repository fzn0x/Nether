// JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/), as Obsidian keeps a
// `.canvas` file (ADR 0051): nodes of text, files, links and groups, and
// edges between them. Reading keeps what it does not know, as another
// app's fields, so a canvas round-trips; writing is as Obsidian writes,
// tab-indented, one node or edge a line, so the two apps' files diff alike.

/** A preset color, "1" to "6" (red, orange, yellow, green, cyan, purple), or "#rrggbb". */
export type CanvasColor = string;

export type Side = "top" | "right" | "bottom" | "left";
export type End = "none" | "arrow";

interface NodeBase {
  readonly id: string;
  /** Where its top start corner is, and how large it is, in canvas pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color?: CanvasColor;
  /** Fields another app wrote that Nether does not read, kept as they were. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface TextNode extends NodeBase {
  readonly type: "text";
  /** Markdown. */
  readonly text: string;
}

export interface FileNode extends NodeBase {
  readonly type: "file";
  /** The file's path in the vault. */
  readonly file: string;
  /** A heading or block in it, from `#`. */
  readonly subpath?: string;
}

export interface LinkNode extends NodeBase {
  readonly type: "link";
  readonly url: string;
}

export interface GroupNode extends NodeBase {
  readonly type: "group";
  readonly label?: string;
  /** An image's path, behind the group. */
  readonly background?: string;
  readonly backgroundStyle?: "cover" | "ratio" | "repeat";
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
  readonly id: string;
  readonly fromNode: string;
  readonly fromSide?: Side;
  /** How the edge starts: none unless it says. */
  readonly fromEnd?: End;
  readonly toNode: string;
  readonly toSide?: Side;
  /** How the edge ends: an arrow unless it says. */
  readonly toEnd?: End;
  readonly color?: CanvasColor;
  readonly label?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface Canvas {
  /** In the order they are drawn, the first beneath the others. */
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  /** Fields of the file beside nodes and edges, kept as they were. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export const emptyCanvas: Canvas = { nodes: [], edges: [] };

/** What reading a file found: the canvas, and what it had to leave out, and why. */
export interface ReadCanvas {
  readonly canvas: Canvas;
  readonly problems: readonly string[];
}

const sides: readonly Side[] = ["top", "right", "bottom", "left"];
const ends: readonly End[] = ["none", "arrow"];
const backgroundStyles = ["cover", "ratio", "repeat"] as const;

const nodeKeys: Readonly<Record<CanvasNode["type"], readonly string[]>> = {
  text: ["text"],
  file: ["file", "subpath"],
  link: ["url"],
  group: ["label", "background", "backgroundStyle"],
};
const baseKeys = ["id", "type", "x", "y", "width", "height", "color"];
const edgeKeys = [
  "id",
  "fromNode",
  "fromSide",
  "fromEnd",
  "toNode",
  "toSide",
  "toEnd",
  "color",
  "label",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The fields of an object that are not among `known`, if any. */
function extraOf(
  value: Record<string, unknown>,
  known: readonly string[],
): { extra?: Record<string, unknown> } {
  const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !known.includes(key)));
  return Object.keys(extra).length === 0 ? {} : { extra };
}

function isColor(value: unknown): value is CanvasColor {
  return typeof value === "string" && /^(?:[1-6]|#[0-9a-fA-F]{6})$/.test(value);
}

/** A string field when it is one, else nothing. */
function optional<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): Partial<Record<Key, string>> {
  const field = value[key];
  return (typeof field === "string" ? { [key]: field } : {}) as Partial<Record<Key, string>>;
}

/** A whole number from a number, as other apps may write fractions. */
function whole(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

function readNode(value: unknown, at: number, problems: string[]): CanvasNode | undefined {
  if (!isObject(value)) {
    problems.push(`Node ${String(at + 1)} is not an object.`);
    return undefined;
  }
  const { id, type } = value;
  const [x, y, width, height] = [value.x, value.y, value.width, value.height].map(whole);
  if (typeof id !== "string" || id === "") {
    problems.push(`Node ${String(at + 1)} has no ID.`);
    return undefined;
  }
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    problems.push(`Node ${id} has no place or size.`);
    return undefined;
  }
  if (type !== "text" && type !== "file" && type !== "link" && type !== "group") {
    problems.push(`Node ${id} is of a type Nether does not know, ${JSON.stringify(type)}.`);
    return undefined;
  }
  const base = {
    id,
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height),
    ...(isColor(value.color) ? { color: value.color } : {}),
    ...extraOf(value, [...baseKeys, ...nodeKeys[type]]),
  };
  if (type === "text") {
    return { ...base, type, text: typeof value.text === "string" ? value.text : "" };
  }
  if (type === "file") {
    if (typeof value.file !== "string" || value.file === "") {
      problems.push(`Node ${id} names no file.`);
      return undefined;
    }
    return { ...base, type, file: value.file, ...optional(value, "subpath") };
  }
  if (type === "link") {
    if (typeof value.url !== "string") {
      problems.push(`Node ${id} has no address.`);
      return undefined;
    }
    return { ...base, type, url: value.url };
  }
  const style = backgroundStyles.find((each) => each === value.backgroundStyle);
  return {
    ...base,
    type,
    ...optional(value, "label"),
    ...optional(value, "background"),
    ...(style === undefined ? {} : { backgroundStyle: style }),
  };
}

function readEdge(
  value: unknown,
  at: number,
  ids: ReadonlySet<string>,
  problems: string[],
): CanvasEdge | undefined {
  if (!isObject(value)) {
    problems.push(`Edge ${String(at + 1)} is not an object.`);
    return undefined;
  }
  const { id, fromNode, toNode } = value;
  if (typeof id !== "string" || id === "") {
    problems.push(`Edge ${String(at + 1)} has no ID.`);
    return undefined;
  }
  if (typeof fromNode !== "string" || typeof toNode !== "string") {
    problems.push(`Edge ${id} does not name the nodes it joins.`);
    return undefined;
  }
  if (!ids.has(fromNode) || !ids.has(toNode)) {
    problems.push(`Edge ${id} joins a node the canvas does not have.`);
    return undefined;
  }
  const side = (key: string) => {
    const found = sides.find((each) => each === value[key]);
    return found === undefined ? {} : { [key]: found };
  };
  const end = (key: string) => {
    const found = ends.find((each) => each === value[key]);
    return found === undefined ? {} : { [key]: found };
  };
  return {
    id,
    fromNode,
    toNode,
    ...side("fromSide"),
    ...end("fromEnd"),
    ...side("toSide"),
    ...end("toEnd"),
    ...(isColor(value.color) ? { color: value.color } : {}),
    ...optional(value, "label"),
    ...extraOf(value, edgeKeys),
  };
}

/**
 * Reads a `.canvas` file's text. An empty file is an empty canvas; text
 * that is not JSON, or not a canvas, throws. A node or edge that cannot be
 * used is left out, and a problem says which and why; a node whose ID
 * another has is left out the second time, and an edge to a node left out
 * with it.
 */
export function readCanvas(text: string): ReadCanvas {
  if (text.trim() === "") return { canvas: emptyCanvas, problems: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The canvas file is not JSON.");
  }
  if (!isObject(data)) throw new Error("The canvas file is not a JSON Canvas.");
  const problems: string[] = [];
  const nodes: CanvasNode[] = [];
  const ids = new Set<string>();
  const rawNodes = Array.isArray(data.nodes) ? (data.nodes as unknown[]) : [];
  rawNodes.forEach((value, at) => {
    const node = readNode(value, at, problems);
    if (node === undefined) return;
    if (ids.has(node.id)) {
      problems.push(`Node ${node.id} is there twice; the second is left out.`);
      return;
    }
    ids.add(node.id);
    nodes.push(node);
  });
  const edges: CanvasEdge[] = [];
  const edgeIds = new Set<string>();
  const rawEdges = Array.isArray(data.edges) ? (data.edges as unknown[]) : [];
  rawEdges.forEach((value, at) => {
    const edge = readEdge(value, at, ids, problems);
    if (edge === undefined) return;
    if (edgeIds.has(edge.id)) {
      problems.push(`Edge ${edge.id} is there twice; the second is left out.`);
      return;
    }
    edgeIds.add(edge.id);
    edges.push(edge);
  });
  return { canvas: { nodes, edges, ...extraOf(data, ["nodes", "edges"]) }, problems };
}

/** A node or edge as the file has it: its fields in the specification's order, then those kept. */
function nodeJson(node: CanvasNode): Record<string, unknown> {
  const { extra, ...fields } = node;
  const ordered: Record<string, unknown> = { id: fields.id, type: fields.type };
  for (const key of nodeKeys[fields.type]) {
    const value = (fields as unknown as Record<string, unknown>)[key];
    if (value !== undefined) ordered[key] = value;
  }
  Object.assign(ordered, { x: fields.x, y: fields.y, width: fields.width, height: fields.height });
  if (fields.color !== undefined) ordered.color = fields.color;
  return { ...ordered, ...extra };
}

function edgeJson(edge: CanvasEdge): Record<string, unknown> {
  const { extra, ...fields } = edge;
  const ordered: Record<string, unknown> = {};
  for (const key of edgeKeys) {
    const value = (fields as Record<string, unknown>)[key];
    if (value !== undefined) ordered[key] = value;
  }
  return { ...ordered, ...extra };
}

/** A canvas as Obsidian writes its file: tab-indented, one node or edge a line. */
export function writeCanvas(canvas: Canvas): string {
  const list = (items: readonly Record<string, unknown>[]) =>
    items.length === 0
      ? "[]"
      : `[\n${items.map((item) => `\t\t${JSON.stringify(item)}`).join(",\n")}\n\t]`;
  const parts = [
    `\t"nodes":${list(canvas.nodes.map(nodeJson))}`,
    `\t"edges":${list(canvas.edges.map(edgeJson))}`,
    ...Object.entries(canvas.extra ?? {}).map(
      ([key, value]) => `\t${JSON.stringify(key)}:${JSON.stringify(value)}`,
    ),
  ];
  return `{\n${parts.join(",\n")}\n}`;
}

/** A new ID, 16 hexadecimal digits as Obsidian's, that `taken` does not have. */
export function newCanvasId(
  taken: ReadonlySet<string>,
  random: () => number = Math.random,
): string {
  for (;;) {
    let id = "";
    for (let digit = 0; digit < 16; digit++) id += Math.floor(random() * 16).toString(16);
    if (!taken.has(id)) return id;
  }
}
