// The graph view's data: notes as nodes and the links between them as
// edges, the whole vault's or those around one note, kept to the notes a
// filter keeps. A link counts once from one note to another, whatever its
// heading, block or alias; links within a note, and to notes the vault does
// not have, draw nothing.
import type { NoteId } from "@nether/core";
import type { GraphNote, LinkGraph } from "./graph.ts";

/** A link drawn from one note to another. */
export interface GraphEdge {
  readonly source: NoteId;
  readonly target: NoteId;
}

/** What the graph view draws. */
export interface GraphData {
  readonly nodes: readonly GraphNote[];
  readonly edges: readonly GraphEdge[];
  /** How many edges each node has, in or out. */
  readonly degrees: ReadonlyMap<NoteId, number>;
}

export interface GraphOptions {
  /** Keeps a note in the graph; every note without it. */
  readonly keep?: (note: GraphNote) => boolean;
  /** Only the notes up to `depth` links from this one, either way, and it. */
  readonly around?: { readonly note: NoteId; readonly depth: number };
  /** Whether notes without links show; they do without it. */
  readonly orphans?: boolean;
}

/** Every link between two notes of the vault, once each way. */
function allEdges(graph: LinkGraph): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const note of graph.notes()) {
    const targets = new Set<NoteId>();
    for (const link of note.index.links) {
      if (link.target === "") continue;
      const target = graph.resolve(link.target, note.path);
      if (target !== undefined && target !== note.id) targets.add(target);
    }
    for (const target of targets) edges.push({ source: note.id, target });
  }
  return edges;
}

/** The notes up to `depth` links from one, either way. */
function nearby(start: NoteId, depth: number, edges: readonly GraphEdge[]): Set<NoteId> {
  const neighbours = new Map<NoteId, NoteId[]>();
  const add = (from: NoteId, to: NoteId) => {
    const list = neighbours.get(from);
    if (list === undefined) neighbours.set(from, [to]);
    else list.push(to);
  };
  for (const edge of edges) {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  }
  const reached = new Set([start]);
  let ring = [start];
  for (let step = 0; step < depth && ring.length > 0; step++) {
    const next: NoteId[] = [];
    for (const note of ring) {
      for (const other of neighbours.get(note) ?? []) {
        if (reached.has(other)) continue;
        reached.add(other);
        next.push(other);
      }
    }
    ring = next;
  }
  return reached;
}

/** The notes and links the graph view draws, by its options. */
export function graphData(graph: LinkGraph, options: GraphOptions = {}): GraphData {
  const { keep, around, orphans = true } = options;
  let edges = allEdges(graph);
  let kept = new Set<NoteId>();
  for (const note of graph.notes()) if (keep === undefined || keep(note)) kept.add(note.id);
  // The note a local graph is around stays, whatever the filter.
  if (around !== undefined && graph.note(around.note) !== undefined) kept.add(around.note);
  edges = edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
  if (around !== undefined) {
    const near = nearby(around.note, around.depth, edges);
    kept = new Set([...kept].filter((note) => near.has(note)));
    edges = edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target));
  }
  const degrees = new Map<NoteId, number>();
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  const nodes: GraphNote[] = [];
  for (const id of kept) {
    const note = graph.note(id);
    if (note === undefined) continue;
    if (!orphans && !degrees.has(id) && id !== around?.note) continue;
    nodes.push(note);
  }
  return { nodes, edges, degrees };
}
