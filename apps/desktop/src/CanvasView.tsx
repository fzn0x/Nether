// A canvas open in a tab (ADR 0051): its `.canvas` file read and drawn,
// read again when another app or device changes it. Nodes are elements in
// a layer moved and scaled to pan and zoom, edges one SVG beneath them.
// Dragging the background or scrolling pans, Ctrl or Cmd and the wheel
// zooms where the pointer is, and the toolbar zooms and fits the canvas to
// the pane. The nodes are in the page in reading order, so the keyboard and
// screen readers go through them as they are read, and the edges are
// listed after them in words.
import {
  type Box,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  canvasBounds,
  edgeGeometry,
  readCanvas,
  readingOrder,
} from "@nether/canvas";
import type { NoteId } from "@nether/core";
import type { Vault } from "@nether/storage";
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { VaultMedia } from "./backend.ts";
import { t } from "./messages.ts";

interface View {
  /** Where the canvas's origin is in the pane, in pixels, and how much it is scaled. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const minZoom = 0.1;
const maxZoom = 4;

function clampZoom(zoom: number): number {
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

/** The view that shows a box whole in a pane, no larger than as it is. */
function fitting(bounds: Box | undefined, width: number, height: number): View {
  if (bounds === undefined) return { x: width / 2, y: height / 2, zoom: 1 };
  const margin = 48;
  const zoom = clampZoom(
    Math.min(1, (width - margin * 2) / bounds.width, (height - margin * 2) / bounds.height),
  );
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}

const imageFile = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/** A color as JSON Canvas gives it, a preset's number or a hex color, as CSS has it. */
function colorOf(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  return /^[1-6]$/.test(color) ? `var(--canvas-color-${color})` : color;
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.(?:md|canvas)$/i, "");
}

/** What a node shows: a text's words, a file's name or image, a link's address, a group's label. */
function NodeBody(props: {
  readonly node: CanvasNode;
  readonly vault: Vault;
  readonly media: VaultMedia;
  readonly onOpenNote: (id: NoteId) => void;
}) {
  const { node, vault, media, onOpenNote } = props;
  if (node.type === "text") return <div className="canvas-text">{node.text}</div>;
  if (node.type === "link") {
    return (
      <a className="canvas-link" href={node.url} target="_blank" rel="noreferrer noopener">
        {node.url}
      </a>
    );
  }
  if (node.type === "group") return null;
  if (imageFile.test(node.file)) {
    const url = media.url(node.file);
    return url === undefined ? (
      <p className="canvas-missing">{t("canvasFileMissing", { name: node.file })}</p>
    ) : (
      <img className="canvas-image" src={url} alt={nameOf(node.file)} draggable={false} />
    );
  }
  const note = vault.noteAt(node.file);
  if (note === undefined) {
    return <p className="canvas-missing">{t("canvasFileMissing", { name: node.file })}</p>;
  }
  return (
    <button
      type="button"
      className="canvas-note"
      onClick={() => {
        onOpenNote(note.id);
      }}
    >
      {note.title}
      {node.subpath === undefined ? null : <span className="canvas-subpath">{node.subpath}</span>}
    </button>
  );
}

/** An edge's line, its arrows, and its label. */
function EdgeLine(props: { readonly edge: CanvasEdge; readonly boxes: ReadonlyMap<string, Box> }) {
  const { edge, boxes } = props;
  const geometry = edgeGeometry(edge, (id) => boxes.get(id));
  if (geometry === undefined) return null;
  const color = colorOf(edge.color) ?? "var(--muted)";
  const arrow = (at: { x: number; y: number }, angle: number) => {
    const size = 12;
    const spread = 0.45;
    const point = (turn: number) =>
      `${String(at.x - size * Math.cos(angle + turn))},${String(at.y - size * Math.sin(angle + turn))}`;
    return (
      <polygon
        points={`${String(at.x)},${String(at.y)} ${point(spread)} ${point(-spread)}`}
        fill={color}
      />
    );
  };
  return (
    <g>
      <path d={geometry.path} fill="none" stroke={color} strokeWidth={2.5} />
      {(edge.toEnd ?? "arrow") === "arrow" ? arrow(geometry.end, geometry.endAngle) : null}
      {(edge.fromEnd ?? "none") === "arrow" ? arrow(geometry.start, geometry.startAngle) : null}
      {edge.label === undefined ? null : (
        <text
          className="canvas-edge-label"
          x={geometry.middle.x}
          y={geometry.middle.y}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

/** What a node is called when an edge or a screen reader names it. */
function describe(node: CanvasNode | undefined): string {
  if (node === undefined) return "";
  if (node.type === "text") return node.text.split("\n")[0]?.slice(0, 80) ?? "";
  if (node.type === "file") return nameOf(node.file);
  if (node.type === "link") return node.url;
  return node.label ?? t("canvasGroup");
}

export default function CanvasView(props: {
  readonly vault: Vault;
  readonly media: VaultMedia;
  readonly path: string;
  readonly onOpenNote: (id: NoteId) => void;
}) {
  const { vault, media, path, onOpenNote } = props;
  const [read, setRead] = useState<
    | { readonly canvas: Canvas; readonly problems: readonly string[] }
    | { readonly error: string }
    | undefined
  >();
  const pane = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | undefined>();

  // Read, and read again when the file changes, as when another app saves it.
  useEffect(() => {
    let current = true;
    let modified: number | undefined;
    const load = () => {
      const info = vault.fileInfo(path);
      if (info === undefined) {
        setRead({ error: t("canvasGone") });
        return;
      }
      if (info.modified === modified) return;
      modified = info.modified;
      void vault.readFile(path).then(
        (file) => {
          if (!current) return;
          if (file.missing === true || file.binary === true) {
            setRead({ error: t("canvasGone") });
            return;
          }
          try {
            setRead(readCanvas(file.text));
          } catch (error) {
            setRead({ error: error instanceof Error ? error.message : String(error) });
          }
        },
        (error: unknown) => {
          if (current) setRead({ error: error instanceof Error ? error.message : String(error) });
        },
      );
    };
    load();
    const stop = vault.subscribe(load);
    return () => {
      current = false;
      stop();
    };
  }, [vault, path]);

  const canvas = read !== undefined && "canvas" in read ? read.canvas : undefined;
  const bounds = useMemo(
    () => (canvas === undefined ? undefined : canvasBounds(canvas.nodes)),
    [canvas],
  );
  const boxes = useMemo(
    () => new Map((canvas?.nodes ?? []).map((node) => [node.id, node] as const)),
    [canvas],
  );
  const ordered = useMemo(() => {
    if (canvas === undefined) return [];
    const rtl = pane.current !== null && getComputedStyle(pane.current).direction === "rtl";
    return readingOrder(canvas.nodes, rtl);
  }, [canvas]);
  const depth = useMemo(
    () => new Map((canvas?.nodes ?? []).map((node, index) => [node.id, index] as const)),
    [canvas],
  );

  const fit = () => {
    const element = pane.current;
    if (element === null) return;
    setView(fitting(bounds, element.clientWidth, element.clientHeight));
  };
  // The first time it is read, the canvas is fitted to the pane.
  useEffect(() => {
    if (canvas !== undefined && view === undefined) fit();
  }, [canvas, view]);

  /** Zooms by a factor, keeping a point of the pane where it is. */
  const zoomBy = (factor: number, at?: { x: number; y: number }) => {
    setView((current) => {
      if (current === undefined) return current;
      const element = pane.current;
      const point = at ?? {
        x: (element?.clientWidth ?? 0) / 2,
        y: (element?.clientHeight ?? 0) / 2,
      };
      const zoom = clampZoom(current.zoom * factor);
      const scale = zoom / current.zoom;
      return {
        zoom,
        x: point.x - (point.x - current.x) * scale,
        y: point.y - (point.y - current.y) * scale,
      };
    });
  };

  // The wheel pans, or with Ctrl or Cmd, as a trackpad's pinch is, zooms; not passive, so the page does not scroll.
  useEffect(() => {
    const element = pane.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        zoomBy(Math.exp(-event.deltaY / 300), {
          x: event.clientX - box.left,
          y: event.clientY - box.top,
        });
      } else {
        setView((current) =>
          current === undefined
            ? current
            : { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY },
        );
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [read]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // The background, or the middle button anywhere, pans.
    const onNode = (event.target as Element).closest(".canvas-node:not(.canvas-group)") !== null;
    if (!(event.button === 1 || (event.button === 0 && !onNode))) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    let last = { x: event.clientX, y: event.clientY };
    const move = (moved: globalThis.PointerEvent) => {
      const dx = moved.clientX - last.x;
      const dy = moved.clientY - last.y;
      last = { x: moved.clientX, y: moved.clientY };
      setView((current) =>
        current === undefined ? current : { ...current, x: current.x + dx, y: current.y + dy },
      );
    };
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };

  const title = nameOf(path);
  if (read !== undefined && "error" in read) {
    return (
      <div className="canvas-view">
        <h1 className="canvas-title">{title}</h1>
        <p role="alert">{read.error}</p>
      </div>
    );
  }

  return (
    <div className="canvas-view">
      <div className="canvas-toolbar">
        <h1 className="canvas-title">{title}</h1>
        <div className="canvas-zoom" role="group" aria-label={t("canvasZoom")}>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              zoomBy(1 / 1.25);
            }}
          >
            {t("zoomOut")}
          </button>
          <span className="canvas-zoom-level" aria-live="polite">
            {`${String(Math.round((view?.zoom ?? 1) * 100))}%`}
          </span>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              zoomBy(1.25);
            }}
          >
            {t("zoomIn")}
          </button>
          <button type="button" className="quiet" onClick={fit}>
            {t("zoomFit")}
          </button>
        </div>
      </div>
      {read !== undefined && read.problems.length > 0 ? (
        <p className="notice" role="status">
          {t("canvasProblems", { count: String(read.problems.length) })}
        </p>
      ) : null}
      <div className="canvas-pane" ref={pane} onPointerDown={onPointerDown}>
        {canvas === undefined || view === undefined ? null : (
          <div
            className="canvas-world"
            style={{
              transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.zoom)})`,
            }}
          >
            <svg className="canvas-edges" aria-hidden="true" width="1" height="1">
              {canvas.edges.map((edge) => (
                <EdgeLine key={edge.id} edge={edge} boxes={boxes} />
              ))}
            </svg>
            {canvas.nodes.length === 0 ? (
              <p className="placeholder canvas-empty">{t("canvasEmpty")}</p>
            ) : null}
            <ul className="canvas-nodes" aria-label={t("canvasNodes", { name: title })}>
              {ordered.map((node) => (
                <li
                  key={node.id}
                  className={`canvas-node canvas-${node.type}${node.type === "group" ? " canvas-group" : ""}`}
                  style={
                    {
                      left: node.x,
                      top: node.y,
                      width: node.width,
                      height: node.height,
                      zIndex: depth.get(node.id) ?? 0,
                      "--node-color": colorOf(node.color),
                    } as CSSProperties
                  }
                >
                  {node.type === "group" && node.label !== undefined ? (
                    <span className="canvas-group-label">{node.label}</span>
                  ) : null}
                  <NodeBody node={node} vault={vault} media={media} onOpenNote={onOpenNote} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {canvas === undefined || canvas.edges.length === 0 ? null : (
          <ul className="visually-hidden" aria-label={t("canvasEdges")}>
            {canvas.edges.map((edge) => (
              <li key={edge.id}>
                {t(edge.label === undefined ? "canvasEdge" : "canvasEdgeLabelled", {
                  from: describe(boxes.get(edge.fromNode)),
                  to: describe(boxes.get(edge.toNode)),
                  label: edge.label ?? "",
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
