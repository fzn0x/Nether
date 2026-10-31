// The graph view (ADR 0025): the vault's notes as dots and their links as
// lines, drawn by Sigma with WebGL so ten thousand notes still move
// smoothly, and laid out by ForceAtlas2 in a worker, away from typing. It
// shows every note, or those around the open note; a filter in search's
// words keeps notes by tag, folder or property. A note opens from its dot,
// or, from the keyboard, from the field that finds it in the graph.
import type { NoteId } from "@nether/core";
import { type GraphData, type LinkGraph, graphData } from "@nether/graph";
import { foldText, parseQuery } from "@nether/search";
import type { Vault } from "@nether/storage";
import Graph from "graphology";
import { type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import type { LayoutRequest, LayoutUpdate } from "./graphLayout.worker.ts";
import { t } from "./messages.ts";
import { passes, switcherMatches } from "./search.ts";
import { useGraph } from "./useGraph.ts";

type Scope = "all" | "around";

/** A note as Sigma draws it. */
interface NodeAttributes {
  x: number;
  y: number;
  label: string;
  size: number;
  color?: string;
  zIndex?: number;
}

interface Colors {
  readonly node: string;
  readonly current: string;
  readonly edge: string;
  readonly label: string;
  readonly faded: string;
}

/** A color of the page's theme as Sigma reads colors: its pixel, in sRGB. */
function themeColor(name: string, alpha = 1): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (context === null || value === "") return `rgba(128, 128, 128, ${String(alpha)})`;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red = 128, green = 128, blue = 128] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha)})`;
}

function themeColors(): Colors {
  return {
    node: themeColor("--muted"),
    current: themeColor("--accent"),
    // Lines as strong against the page as graphics must be, 3 to 1.
    edge: themeColor("--muted", 0.7),
    label: themeColor("--text"),
    faded: themeColor("--muted", 0.25),
  };
}

/** A place to start a note from, the same each time for the same note. */
function seeded(id: string): { x: number; y: number } {
  let hash = 2166136261;
  for (let at = 0; at < id.length; at++) hash = Math.imul(hash ^ id.charCodeAt(at), 16777619);
  const angle = ((hash >>> 0) / 2 ** 32) * Math.PI * 2;
  const radius = 10 + (((hash >>> 16) & 0xffff) / 0xffff) * 90;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** How many links a graph has before they hide while it zooms and pans, to keep it smooth. */
const manyEdges = 5000;

/** How long to lay out so many notes, in milliseconds. */
function layoutBudget(nodes: number): number {
  return Math.min(8000, 1500 + nodes * 0.4);
}

/** Keeps the notes a filter in search's words keeps: words in their names or paths, and tag:, path: and prop:. */
function filterOf(graph: LinkGraph, text: string) {
  if (text.trim() === "") return undefined;
  const query = parseQuery(text);
  const words = [...query.words, ...query.phrases].map(foldText);
  const excluded = query.excluded.map(foldText);
  return (note: { readonly id: NoteId; readonly path: string; readonly title: string }) => {
    const name = foldText(`${note.title} ${note.path}`);
    return (
      words.every((word) => name.includes(word)) &&
      !excluded.some((word) => name.includes(word)) &&
      query.filters.every((filter) => passes(graph, note, filter)) &&
      !query.excludedFilters.some((filter) => passes(graph, note, filter))
    );
  };
}

export default function GraphView(props: {
  readonly vault: Vault;
  readonly graph: LinkGraph;
  /** The note open before the graph, which a local graph is around. */
  readonly note: NoteId | undefined;
  readonly onOpenNote: (id: NoteId) => void;
  readonly onClose: () => void;
}) {
  const { vault, graph, note, onOpenNote, onClose } = props;
  const version = useGraph(graph);
  const [scope, setScope] = useState<Scope>("all");
  const [depth, setDepth] = useState(1);
  const [filter, setFilter] = useState("");
  const [find, setFind] = useState("");
  const [found, setFound] = useState<NoteId | undefined>();
  const [notFound, setNotFound] = useState(false);
  const [arranging, setArranging] = useState(false);
  // Why the graph cannot be drawn, as on a system without WebGL.
  const [unavailable, setUnavailable] = useState<string | undefined>();
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma<NodeAttributes> | undefined>(undefined);
  const sigmaGraph = useRef(new Graph<NodeAttributes>({ multi: false, type: "directed" }));
  // Where each note was last placed, so a change to the graph keeps the rest where they were.
  const placed = useRef(new Map<string, { x: number; y: number }>());
  const worker = useRef<Worker | undefined>(undefined);
  const hovered = useRef<string | undefined>(undefined);
  // Whether a large graph's links are hidden while its notes are laid out.
  const linksHidden = useRef(false);
  const chosen = useRef<string | undefined>(undefined);
  const [layoutRound, setLayoutRound] = useState(0);
  // The latest way to open a note, for Sigma's clicks.
  const open = useRef(onOpenNote);
  open.current = onOpenNote;

  const around = scope === "around" && note !== undefined ? note : undefined;
  const data: GraphData = useMemo(() => {
    const keep = filterOf(graph, filter);
    return graphData(graph, {
      ...(keep === undefined ? {} : { keep }),
      ...(around === undefined ? {} : { around: { note: around, depth } }),
    });
  }, [graph, version, filter, around, depth]);

  // Sigma and the layout's worker, once for the view.
  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const colors = themeColors();
    let sigma: Sigma<NodeAttributes>;
    try {
      sigma = new Sigma(sigmaGraph.current, element, {
        allowInvalidContainer: true,
        defaultEdgeColor: colors.edge,
        defaultNodeColor: colors.node,
        labelColor: { color: colors.label },
        labelFont: getComputedStyle(document.body).fontFamily,
        labelSize: 12,
        // Sigma leaves out labels that would overlap, the smaller notes' first.
        labelRenderedSizeThreshold: 4,
        zIndex: true,
        nodeReducer: (node, attributes) => {
          const focus = hovered.current ?? chosen.current;
          if (focus === undefined) return attributes;
          if (node === focus) return { ...attributes, color: colors.current, highlighted: true };
          return sigmaGraph.current.areNeighbors(node, focus)
            ? attributes
            : { ...attributes, color: colors.faded, label: "" };
        },
        edgeReducer: (edge, attributes) => {
          if (linksHidden.current) return { ...attributes, hidden: true };
          const focus = hovered.current ?? chosen.current;
          if (focus === undefined) return attributes;
          return sigmaGraph.current.hasExtremity(edge, focus)
            ? attributes
            : { ...attributes, hidden: true };
        },
      });
    } catch (error) {
      setUnavailable(error instanceof Error ? error.message : String(error));
      return;
    }
    sigma.on("clickNode", ({ node }) => {
      open.current(node as NoteId);
    });
    sigma.on("enterNode", ({ node }) => {
      hovered.current = node;
      element.style.cursor = "pointer";
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      hovered.current = undefined;
      element.style.cursor = "";
      sigma.refresh({ skipIndexation: true });
    });
    renderer.current = sigma;
    const layout = new Worker(new URL("./graphLayout.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = layout;
    return () => {
      layout.terminate();
      worker.current = undefined;
      sigma.kill();
      renderer.current = undefined;
    };
  }, []);

  // The graph to draw: the notes and links the options give, placed where they were.
  useEffect(() => {
    const drawn = sigmaGraph.current;
    const colors = themeColors();
    drawn.clear();
    const order: string[] = [];
    for (const node of data.nodes) {
      const place = placed.current.get(node.id) ?? seeded(node.id);
      const degree = data.degrees.get(node.id) ?? 0;
      drawn.addNode(node.id, {
        ...place,
        label: node.title,
        size: 4 + Math.sqrt(degree) * 1.5,
        ...(node.id === note ? { color: colors.current, zIndex: 1 } : {}),
      });
      order.push(node.id);
    }
    for (const edge of data.edges) {
      if (!drawn.hasEdge(edge.source, edge.target)) drawn.addEdge(edge.source, edge.target);
    }
    renderer.current?.setSetting("hideEdgesOnMove", data.edges.length > manyEdges);
    if (chosen.current !== undefined && !drawn.hasNode(chosen.current)) {
      chosen.current = undefined;
      setFound(undefined);
    }
    // Laid out again from where they are.
    const layout = worker.current;
    if (layout === undefined || order.length === 0) return;
    const index = new Map(order.map((id, at) => [id, at]));
    const positions = new Float32Array(order.length * 2);
    drawn.forEachNode((id, attributes) => {
      const at = (index.get(id) ?? 0) * 2;
      positions[at] = attributes.x;
      positions[at + 1] = attributes.y;
    });
    const edges = new Uint32Array(data.edges.length * 2);
    data.edges.forEach((edge, at) => {
      edges[at * 2] = index.get(edge.source) ?? 0;
      edges[at * 2 + 1] = index.get(edge.target) ?? 0;
    });
    setArranging(true);
    // A large graph's links show once its notes are in place: drawn as they
    // move, they would cost a frame each time.
    linksHidden.current = data.edges.length > manyEdges;
    layout.onmessage = (event: MessageEvent<LayoutUpdate>) => {
      const { positions: moved, done } = event.data;
      drawn.updateEachNodeAttributes(
        (id, attributes) => {
          const at = index.get(id);
          if (at === undefined) return attributes;
          const place = { x: moved[at * 2] ?? 0, y: moved[at * 2 + 1] ?? 0 };
          placed.current.set(id, place);
          return { ...attributes, ...place };
        },
        { attributes: ["x", "y"] },
      );
      if (done) {
        setArranging(false);
        linksHidden.current = false;
        renderer.current?.refresh({ skipIndexation: true });
      }
    };
    const request: LayoutRequest = {
      positions,
      edges,
      budget: layoutBudget(order.length),
      // A large graph moves twice a second, as each move costs a frame; a small one ten times.
      every: data.edges.length > manyEdges ? 500 : 100,
    };
    layout.postMessage(request, [positions.buffer, edges.buffer]);
  }, [data, note, layoutRound]);

  /** Finds a note in the graph by its name, an alias or its path, and shows it. */
  const findNote = (event: SyntheticEvent) => {
    event.preventDefault();
    const drawn = sigmaGraph.current;
    const match = switcherMatches(vault, graph, find, 200).find((item) =>
      drawn.hasNode(item.note.id),
    );
    setNotFound(match === undefined);
    chosen.current = match?.note.id;
    setFound(match?.note.id);
    const sigma = renderer.current;
    if (sigma === undefined) return;
    sigma.refresh({ skipIndexation: true });
    if (match === undefined) return;
    const shown = sigma.getNodeDisplayData(match.note.id);
    if (shown !== undefined) {
      void sigma.getCamera().animate({ x: shown.x, y: shown.y, ratio: 0.4 }, { duration: 400 });
    }
  };

  const foundTitle = found === undefined ? undefined : graph.note(found)?.title;
  const noteTitle = note === undefined ? undefined : graph.note(note)?.title;
  return (
    <section className="graph-view" aria-labelledby="graph-title">
      <header className="graph-header">
        <h1 id="graph-title">{t("graph")}</h1>
        <button type="button" className="quiet" onClick={onClose}>
          {noteTitle === undefined ? t("closeGraph") : t("backToNote", { title: noteTitle })}
        </button>
      </header>
      <div className="graph-tools">
        <fieldset className="graph-scope">
          <legend>{t("graphShows")}</legend>
          <label>
            <input
              type="radio"
              name="graph-scope"
              checked={scope === "all"}
              onChange={() => {
                setScope("all");
              }}
            />
            {t("graphAll")}
          </label>
          <label>
            <input
              type="radio"
              name="graph-scope"
              checked={scope === "around"}
              disabled={note === undefined}
              onChange={() => {
                setScope("around");
              }}
            />
            {noteTitle === undefined
              ? t("graphAroundNone")
              : t("graphAround", { title: noteTitle })}
          </label>
          {scope === "around" ? (
            <label>
              {t("graphDepth")}
              <select
                value={depth}
                onChange={(event) => {
                  setDepth(Number(event.target.value));
                }}
              >
                {[1, 2, 3].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
        <label className="graph-filter">
          {t("graphFilter")}
          <input
            type="search"
            value={filter}
            placeholder="tag:project path:Projects prop:status"
            spellCheck={false}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />
        </label>
        <form className="graph-find" onSubmit={findNote}>
          <label>
            {t("graphFind")}
            <input
              type="search"
              value={find}
              spellCheck={false}
              onChange={(event) => {
                setFind(event.target.value);
                setNotFound(false);
              }}
            />
          </label>
          <button type="submit" className="quiet">
            {t("graphFindButton")}
          </button>
          {found !== undefined && foundTitle !== undefined ? (
            <button
              type="button"
              onClick={() => {
                onOpenNote(found);
              }}
            >
              {t("graphOpen", { title: foundTitle })}
            </button>
          ) : null}
        </form>
      </div>
      <div className="graph-status">
        <p role="status">
          {notFound ? `${t("graphNotFound")} ` : ""}
          {t("graphCount", { notes: data.nodes.length, links: data.edges.length })}
          {arranging ? ` ${t("graphArranging")}` : ""}
        </p>
        {/* The camera from the keyboard, as the mouse wheel and dragging move it. */}
        <button
          type="button"
          className="quiet"
          onClick={() => {
            void renderer.current?.getCamera().animatedZoom({ factor: 1.5, duration: 200 });
          }}
        >
          {t("graphZoomIn")}
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            void renderer.current?.getCamera().animatedUnzoom({ factor: 1.5, duration: 200 });
          }}
        >
          {t("graphZoomOut")}
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            void renderer.current?.getCamera().animatedReset({ duration: 200 });
          }}
        >
          {t("graphFit")}
        </button>
        <button
          type="button"
          className="quiet"
          disabled={arranging}
          onClick={() => {
            setLayoutRound((count) => count + 1);
          }}
        >
          {t("graphArrange")}
        </button>
      </div>
      {unavailable === undefined ? null : (
        <p role="alert">{t("graphUnavailable", { error: unavailable })}</p>
      )}
      <div
        ref={container}
        className="graph-canvas"
        role="img"
        aria-label={t("graphPicture", { notes: data.nodes.length, links: data.edges.length })}
      />
    </section>
  );
}
