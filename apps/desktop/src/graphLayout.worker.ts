// Lays out the graph view's notes away from the page's main thread, with
// ForceAtlas2: linked notes pull together and the rest push apart. It moves
// them in steps of about a twentieth of a second, sends where they are as
// often as the page asks, and stops when its time is up or the page starts
// another layout.
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

export interface LayoutRequest {
  /** Each node's place to start from, x then y. */
  readonly positions: Float32Array;
  /** Each edge's two nodes, by their places in `positions`. */
  readonly edges: Uint32Array;
  /** How long to lay them out for, in milliseconds. */
  readonly budget: number;
  /** How long between the places it sends, in milliseconds: each costs the page a frame. */
  readonly every: number;
}

export interface LayoutUpdate {
  readonly positions: Float32Array;
  /** Whether this is where they end. */
  readonly done: boolean;
}

/** How long a step may take, in milliseconds. */
const stepTime = 50;

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: LayoutUpdate, transfer: Transferable[]): void;
};

// A new request stops the layout before it.
let run = 0;

scope.onmessage = (event) => {
  const { positions, edges, budget, every } = event.data;
  run += 1;
  const current = run;
  const count = positions.length / 2;
  const graph = new Graph<{ x: number; y: number }>({ multi: true });
  for (let node = 0; node < count; node++) {
    graph.addNode(String(node), { x: positions[node * 2] ?? 0, y: positions[node * 2 + 1] ?? 0 });
  }
  for (let at = 0; at + 1 < edges.length; at += 2) {
    graph.addEdge(String(edges[at]), String(edges[at + 1]));
  }
  // Strong gravity keeps notes without links, and small groups, near the rest.
  const settings = { ...forceAtlas2.inferSettings(graph), strongGravityMode: true, gravity: 0.5 };
  const started = performance.now();
  let sent = 0;
  let iterations = 1;
  const step = () => {
    if (current !== run) return;
    const before = performance.now();
    forceAtlas2.assign(graph, { iterations, settings });
    // As many iterations as fit in a step, measured as it goes.
    const took = Math.max(1, performance.now() - before) / iterations;
    iterations = Math.max(1, Math.floor(stepTime / took));
    const done = performance.now() - started >= budget;
    if (!done && performance.now() - sent < every) {
      setTimeout(step, 0);
      return;
    }
    sent = performance.now();
    const placed = new Float32Array(count * 2);
    graph.forEachNode((node, attributes) => {
      const at = Number(node) * 2;
      placed[at] = attributes.x;
      placed[at + 1] = attributes.y;
    });
    scope.postMessage({ positions: placed, done }, [placed.buffer]);
    if (!done) setTimeout(step, 0);
  };
  step();
};
