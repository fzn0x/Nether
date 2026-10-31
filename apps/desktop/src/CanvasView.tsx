// A canvas open in a tab (ADR 0051): its `.canvas` file read, drawn and
// edited, written back a moment after each change, and read again when
// another app or device changes it. Nodes are elements in a layer moved and
// scaled to pan and zoom, edges one SVG beneath them.
//
// The pointer drags the background to pan, Ctrl or Cmd and the wheel to
// zoom; it selects, moves and resizes cards, draws arrows from the dots on a
// card's sides, and double-clicks the background for a text card or a text
// card to write in it. Everything is reachable without it: the cards are in
// the page in reading order, so Tab goes through them; the arrow keys move
// one, Alt and the arrows resize it, Enter writes in it or opens what it
// shows, Delete removes it, and its menu, on the menu key, connects it to
// another card, colors it or removes it. Ctrl or Cmd and Z undoes.
import {
  type Box,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type History,
  type Side,
  addNode,
  canvasBounds,
  canvasIds,
  connect,
  edgeGeometry,
  facingSides,
  moveNodes,
  newCanvasId,
  nodeAt,
  readCanvas,
  readingOrder,
  record,
  redo,
  removeItems,
  resizeNode,
  setColor,
  setLabel,
  setText,
  sidePoint,
  updateNode,
  snap,
  startHistory,
  undo,
  writeCanvas,
} from "@nether/canvas";
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import type { Vault } from "@nether/storage";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { VaultMedia } from "./backend.ts";
import { CardBody, isImagePath } from "./CanvasCards.tsx";
import {
  ContextMenu,
  type MenuEntry,
  type MenuPoint,
  isMenuKey,
  pointBelow,
} from "./ContextMenu.tsx";
import { QuickSwitcher } from "./QuickSwitcher.tsx";
import { TextPromptDialog } from "./TextPromptDialog.tsx";
import { t } from "./messages.ts";
import { attachmentName, attachmentsFolder } from "./noteFiles.ts";

interface View {
  /** Where the canvas's origin is in the pane, in pixels, and how much it is scaled. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const minZoom = 0.1;
const maxZoom = 4;
/** How long after a change the file is written. */
const saveDelay = 400;
/** How far the arrow keys move a card, and resize it with Alt. */
const keyStep = 20;

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

const sides: readonly Side[] = ["top", "right", "bottom", "left"];
const colors = ["1", "2", "3", "4", "5", "6"] as const;

/** A color as JSON Canvas gives it, a preset's number or a hex color, as CSS has it. */
function colorOf(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  return /^[1-6]$/.test(color) ? `var(--canvas-color-${color})` : color;
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.(?:md|canvas)$/i, "");
}

/** What a node is called when an edge, a menu or a screen reader names it. */
function describe(node: CanvasNode | undefined): string {
  if (node === undefined) return "";
  if (node.type === "text") {
    const first = node.text.split("\n").find((line) => line.trim() !== "") ?? "";
    return first.trim().slice(0, 80) || t("canvasTextCard");
  }
  if (node.type === "file") return nameOf(node.file);
  if (node.type === "link") return node.url;
  return node.label ?? t("canvasGroup");
}

/** The side of a box nearest a point, for an arrow drawn to it. */
function nearestSide(box: Box, point: Point): Side {
  let best: Side = "top";
  let distance = Infinity;
  for (const side of sides) {
    const at = sidePoint(box, side);
    const far = Math.hypot(at.x - point.x, at.y - point.y);
    if (far < distance) {
      distance = far;
      best = side;
    }
  }
  return best;
}

/** An edge's line, its arrows, its label, and a wider line beneath to take hold of it by. */
function EdgeLine(props: {
  readonly edge: CanvasEdge;
  readonly boxes: ReadonlyMap<string, Box>;
  readonly selected: boolean;
  readonly onSelect?: (event: PointerEvent<SVGPathElement>) => void;
}) {
  const { edge, boxes, selected, onSelect } = props;
  const geometry = edgeGeometry(edge, (id) => boxes.get(id));
  if (geometry === undefined) return null;
  const color = colorOf(edge.color) ?? "var(--muted)";
  const arrow = (at: Point, angle: number) => {
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
    <g className={selected ? "canvas-edge selected" : "canvas-edge"}>
      {onSelect === undefined ? null : (
        <path d={geometry.path} className="canvas-edge-hit" onPointerDown={onSelect} />
      )}
      <path d={geometry.path} fill="none" stroke={color} strokeWidth={selected ? 4 : 2.5} />
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

type Loaded =
  | {
      readonly history: History;
      readonly problems: readonly string[];
    }
  | { readonly error: string };

/** A node as it is added, its ID given then. */
type NewNode = CanvasNode extends infer Node
  ? Node extends CanvasNode
    ? Omit<Node, "id">
    : never
  : never;

/** What the pointer is doing on the board, while it does it. */
type Gesture =
  | {
      readonly kind: "move";
      readonly ids: readonly string[];
      readonly dx: number;
      readonly dy: number;
    }
  | { readonly kind: "resize"; readonly id: string; readonly box: Box }
  | { readonly kind: "connect"; readonly from: string; readonly side: Side; readonly to: Point };

export default function CanvasView(props: {
  readonly vault: Vault;
  readonly graph: LinkGraph;
  readonly media: VaultMedia;
  readonly path: string;
  readonly onOpenNote: (id: NoteId) => void;
}) {
  const { vault, graph, media, path, onOpenNote } = props;
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const pane = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | undefined>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | undefined>();
  const [gesture, setGesture] = useState<Gesture | undefined>();
  const [menu, setMenu] = useState<{ readonly id: string; readonly at: MenuPoint } | undefined>();
  const [connecting, setConnecting] = useState<{ readonly from: string; readonly at: MenuPoint }>();
  const [labelling, setLabelling] = useState<string | undefined>();
  const [naming, setNaming] = useState<string | undefined>();
  const [linking, setLinking] = useState(false);
  const [pickingNote, setPickingNote] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  // The hash of the text the file has, as last read or written, and whether a change waits to be written.
  const hash = useRef("");
  const dirty = useRef(false);
  const live = useRef(true);

  // Read, and read again when the file changes, as when another app saves it;
  // not while a change of this view waits to be written, nor for its own writes.
  const load = useCallback(() => {
    if (dirty.current) return;
    if (vault.fileInfo(path) === undefined) {
      setLoaded({ error: t("canvasGone") });
      return;
    }
    void vault.readFile(path).then(
      (file) => {
        if (!live.current || dirty.current) return;
        if (file.missing === true || file.binary === true) {
          setLoaded({ error: t("canvasGone") });
          return;
        }
        if (file.hash === hash.current) return;
        hash.current = file.hash;
        try {
          const read = readCanvas(file.text);
          setLoaded({ history: startHistory(read.canvas), problems: read.problems });
        } catch (error) {
          setLoaded({ error: error instanceof Error ? error.message : String(error) });
        }
      },
      (error: unknown) => {
        if (live.current)
          setLoaded({ error: error instanceof Error ? error.message : String(error) });
      },
    );
  }, [vault, path]);

  useEffect(() => {
    live.current = true;
    hash.current = "";
    load();
    const stop = vault.subscribe(load);
    return () => {
      live.current = false;
      stop();
    };
  }, [vault, load]);

  const history = loaded !== undefined && "history" in loaded ? loaded.history : undefined;
  const saved = history?.present;
  // What cannot be read would be lost if the file were written: such a canvas is not changed here.
  const editable = loaded !== undefined && "history" in loaded && loaded.problems.length === 0;

  // The file is written a moment after the last change.
  const pending = useRef<Canvas | undefined>(undefined);
  useEffect(() => {
    const canvas = pending.current;
    if (canvas === undefined) return;
    const timer = setTimeout(() => {
      pending.current = undefined;
      vault.writeFile(path, writeCanvas(canvas), hash.current).then(
        (written) => {
          hash.current = written.hash;
          dirty.current = pending.current !== undefined;
        },
        () => {
          // Changed elsewhere since it was read: what the file has now shows.
          dirty.current = false;
          hash.current = "";
          setNotice(t("canvasChangedElsewhere"));
          load();
        },
      );
    }, saveDelay);
    return () => {
      clearTimeout(timer);
    };
  }, [saved, vault, path, load]);

  /** Makes a change, keeps it for undo, and writes it soon. */
  const change = useCallback((make: (canvas: Canvas) => Canvas) => {
    setLoaded((current) => {
      if (current === undefined || !("history" in current) || current.problems.length > 0)
        return current;
      const next = make(current.history.present);
      if (next === current.history.present) return current;
      dirty.current = true;
      pending.current = next;
      return { ...current, history: record(current.history, next) };
    });
  }, []);

  const step = useCallback((back: boolean) => {
    setLoaded((current) => {
      if (current === undefined || !("history" in current)) return current;
      const next = back ? undo(current.history) : redo(current.history);
      if (next === current.history) return current;
      dirty.current = true;
      pending.current = next.present;
      return { ...current, history: next };
    });
  }, []);

  // While the pointer moves or resizes, the canvas shows where things will be.
  const shown = useMemo(() => {
    if (saved === undefined || gesture === undefined) return saved;
    if (gesture.kind === "move") return moveNodes(saved, gesture.ids, gesture.dx, gesture.dy);
    if (gesture.kind === "resize") return resizeNode(saved, gesture.id, gesture.box);
    return saved;
  }, [saved, gesture]);

  const bounds = useMemo(
    () => (shown === undefined ? undefined : canvasBounds(shown.nodes)),
    [shown],
  );
  const boxes = useMemo(
    () => new Map((shown?.nodes ?? []).map((node) => [node.id, node] as const)),
    [shown],
  );
  const ordered = useMemo(() => {
    if (shown === undefined) return [];
    const rtl = pane.current !== null && getComputedStyle(pane.current).direction === "rtl";
    return readingOrder(shown.nodes, rtl);
  }, [shown]);
  const depth = useMemo(
    () => new Map((shown?.nodes ?? []).map((node, index) => [node.id, index] as const)),
    [shown],
  );

  const fit = useCallback(() => {
    const element = pane.current;
    if (element === null) return;
    setView(fitting(bounds, element.clientWidth, element.clientHeight));
  }, [bounds]);
  // The first time it is read, the canvas is fitted to the pane.
  useEffect(() => {
    if (shown !== undefined && view === undefined) fit();
  }, [shown, view, fit]);

  /** A point of the pane, in pixels from its corner, as a point of the canvas. */
  const toCanvas = useCallback(
    (clientX: number, clientY: number): Point => {
      const element = pane.current;
      const box = element?.getBoundingClientRect();
      const current = view ?? { x: 0, y: 0, zoom: 1 };
      return {
        x: (clientX - (box?.left ?? 0) - current.x) / current.zoom,
        y: (clientY - (box?.top ?? 0) - current.y) / current.zoom,
      };
    },
    [view],
  );

  /** The middle of what the pane shows, in the canvas, where cards added from the toolbar go. */
  const middle = (): Point => {
    const element = pane.current;
    const box = element?.getBoundingClientRect();
    return toCanvas(
      (box?.left ?? 0) + (box?.width ?? 0) / 2,
      (box?.top ?? 0) + (box?.height ?? 0) / 2,
    );
  };

  /** Zooms by a factor, keeping a point of the pane where it is. */
  const zoomBy = (factor: number, at?: Point) => {
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
      if ((event.target as Element).closest("textarea") !== null) return;
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
  }, [loaded]);

  /** Follows the pointer until it is let go, then calls `done` unless it was cancelled. */
  const follow = (
    event: PointerEvent,
    moved: (from: Point, now: Point, event: globalThis.PointerEvent) => void,
    done: (event: globalThis.PointerEvent) => void,
  ) => {
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    const move = (next: globalThis.PointerEvent) => {
      moved(start, { x: next.clientX, y: next.clientY }, next);
    };
    const end = (next: globalThis.PointerEvent) => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", cancel);
      done(next);
    };
    const cancel = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", cancel);
      setGesture(undefined);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", cancel);
  };

  const onPanePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    // The background, or the middle button anywhere, pans.
    const onItem =
      target.closest(".canvas-node:not(.canvas-group), .canvas-handle, .canvas-edge-hit") !== null;
    if (!(event.button === 1 || (event.button === 0 && !onItem))) return;
    if (event.button === 0 && target.closest(".canvas-group") === null) setSelected(new Set());
    event.preventDefault();
    let last = { x: event.clientX, y: event.clientY };
    follow(
      event,
      (_from, now) => {
        const dx = now.x - last.x;
        const dy = now.y - last.y;
        last = now;
        setView((current) =>
          current === undefined ? current : { ...current, x: current.x + dx, y: current.y + dy },
        );
      },
      () => undefined,
    );
  };

  const onNodePointerDown = (event: PointerEvent<HTMLLIElement>, node: CanvasNode) => {
    if (event.button !== 0 || !editable || editing === node.id) return;
    const target = event.target as Element;
    if (target.closest(".canvas-handle, textarea, a, button") !== null) return;
    // A group's inside is the board, to pan; its edge and label take hold of it.
    if (
      node.type === "group" &&
      target.closest(".canvas-group-label") === null &&
      target === event.currentTarget
    ) {
      const inner = toCanvas(event.clientX, event.clientY);
      const edge = 12 / (view?.zoom ?? 1);
      const near =
        inner.x - node.x < edge ||
        inner.y - node.y < edge ||
        node.x + node.width - inner.x < edge ||
        node.y + node.height - inner.y < edge;
      if (!near) return;
    }
    event.stopPropagation();
    event.preventDefault();
    const ids = event.shiftKey
      ? new Set(
          [...selected]
            .filter((id) => id !== node.id)
            .concat(selected.has(node.id) ? [] : [node.id]),
        )
      : selected.has(node.id)
        ? selected
        : new Set([node.id]);
    setSelected(ids);
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    const moving = [...ids].filter((id) => boxes.has(id));
    const zoom = view?.zoom ?? 1;
    follow(
      event,
      (from, now) => {
        setGesture({
          kind: "move",
          ids: moving,
          dx: snap((now.x - from.x) / zoom, 10),
          dy: snap((now.y - from.y) / zoom, 10),
        });
      },
      (end) => {
        const dx = snap((end.clientX - event.clientX) / zoom, 10);
        const dy = snap((end.clientY - event.clientY) / zoom, 10);
        setGesture(undefined);
        if (dx !== 0 || dy !== 0) change((canvas) => moveNodes(canvas, moving, dx, dy));
      },
    );
  };

  const onResizePointerDown = (event: PointerEvent<HTMLSpanElement>, node: CanvasNode) => {
    event.stopPropagation();
    event.preventDefault();
    const zoom = view?.zoom ?? 1;
    const boxOf = (now: Point, from: Point): Box => ({
      x: node.x,
      y: node.y,
      width: snap(node.width + (now.x - from.x) / zoom, 10),
      height: snap(node.height + (now.y - from.y) / zoom, 10),
    });
    follow(
      event,
      (from, now) => {
        setGesture({ kind: "resize", id: node.id, box: boxOf(now, from) });
      },
      (end) => {
        const box = boxOf(
          { x: end.clientX, y: end.clientY },
          { x: event.clientX, y: event.clientY },
        );
        setGesture(undefined);
        change((canvas) => resizeNode(canvas, node.id, box));
      },
    );
  };

  const onHandlePointerDown = (
    event: PointerEvent<HTMLSpanElement>,
    node: CanvasNode,
    side: Side,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    follow(
      event,
      (_from, now) => {
        setGesture({ kind: "connect", from: node.id, side, to: toCanvas(now.x, now.y) });
      },
      (end) => {
        setGesture(undefined);
        if (saved === undefined) return;
        const point = toCanvas(end.clientX, end.clientY);
        const target = nodeAt(saved.nodes, point);
        if (target === undefined || target.id === node.id) return;
        change((canvas) =>
          connect(
            canvas,
            { id: newCanvasId(canvasIds(canvas)), from: node.id, to: target.id },
            { fromSide: side, toSide: nearestSide(target, point) },
          ),
        );
      },
    );
  };

  /** Adds a card, selects it, and for a text card, starts writing in it. */
  const add = (node: NewNode) => {
    if (saved === undefined) return;
    const id = newCanvasId(canvasIds(saved));
    change((canvas) => addNode(canvas, { ...node, id }));
    setSelected(new Set([id]));
    if (node.type === "text") setEditing(id);
    else {
      requestAnimationFrame(() => {
        document.getElementById(`canvas-node-${id}`)?.focus();
      });
    }
  };

  const addText = (at: Point) => {
    add({
      type: "text",
      text: "",
      x: snap(at.x - 125, 10),
      y: snap(at.y - 30, 10),
      width: 250,
      height: 60,
    });
  };

  /** A group around the cards selected, or, with none, an empty one in the middle. */
  const addGroup = () => {
    if (saved === undefined) return;
    const inside = saved.nodes.filter((node) => selected.has(node.id));
    const around = canvasBounds(inside);
    const margin = 40;
    const at = middle();
    const box =
      around === undefined
        ? { x: snap(at.x - 200, 10), y: snap(at.y - 150, 10), width: 400, height: 300 }
        : {
            x: around.x - margin,
            y: around.y - margin,
            width: around.width + margin * 2,
            height: around.height + margin * 2,
          };
    add({ type: "group", label: t("canvasGroup"), ...box });
  };

  /** Puts files dropped from elsewhere on the board: images kept in the vault, notes and canvases by path. */
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!editable) return;
    const at = toCanvas(event.clientX, event.clientY);
    const dragged = event.dataTransfer.getData("application/x-nether-path");
    if (dragged !== "") {
      event.preventDefault();
      try {
        const { kind, path: file } = JSON.parse(dragged) as { kind?: unknown; path?: unknown };
        if ((kind === "note" || kind === "file") && typeof file === "string") {
          add({
            type: "file",
            file,
            x: snap(at.x - 200, 10),
            y: snap(at.y - 150, 10),
            width: 400,
            height: 300,
          });
        }
      } catch {
        // Not a drag Nether made.
      }
      return;
    }
    const images = [...event.dataTransfer.files].filter((file) => isImagePath(file.name));
    if (images.length === 0) return;
    event.preventDefault();
    void (async () => {
      let offset = 0;
      for (const image of images) {
        const kept = await vault.attach(
          `${attachmentsFolder}/${attachmentName(image, false, new Date())}`,
          new Uint8Array(await image.arrayBuffer()),
        );
        add({
          type: "file",
          file: kept,
          x: snap(at.x + offset, 10),
          y: snap(at.y + offset, 10),
          width: 400,
          height: 300,
        });
        offset += 40;
      }
    })().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : String(error));
    });
  };

  const remove = (ids: Iterable<string>) => {
    const list = [...ids];
    if (list.length === 0) return;
    change((canvas) => removeItems(canvas, list));
    setSelected(new Set());
  };

  const onNodeKeyDown = (event: KeyboardEvent<HTMLLIElement>, node: CanvasNode) => {
    if (event.target !== event.currentTarget) return;
    if (isMenuKey(event)) {
      event.preventDefault();
      setMenu({ id: node.id, at: pointBelow(event.currentTarget) });
      return;
    }
    const arrows: Record<string, Point | undefined> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    const arrow = arrows[event.key];
    if (arrow !== undefined && editable) {
      event.preventDefault();
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      const dx = arrow.x * keyStep * (rtl && !event.altKey ? -1 : 1);
      const dy = arrow.y * keyStep;
      if (event.altKey) {
        change((canvas) =>
          resizeNode(canvas, node.id, {
            ...node,
            width: node.width + dx,
            height: node.height + dy,
          }),
        );
      } else change((canvas) => moveNodes(canvas, [node.id], dx, dy));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (node.type === "text" && editable) setEditing(node.id);
      else if (node.type === "file") {
        const note = vault.noteAt(node.file);
        if (note !== undefined) onOpenNote(note.id);
      } else if (node.type === "link") window.open(node.url, "_blank", "noopener");
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && editable) {
      event.preventDefault();
      remove(selected.has(node.id) ? selected : [node.id]);
      return;
    }
    if (event.key === "Escape") setSelected(new Set());
  };

  const onViewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("textarea, input") !== null) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      step(!event.shiftKey);
    } else if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      step(false);
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      editable &&
      selected.size > 0
    ) {
      event.preventDefault();
      remove(selected);
    }
  };

  const colorEntries = (id: string): MenuEntry[] => [
    {
      label: t("canvasNoColor"),
      run: () => {
        change((canvas) => setColor(canvas, id, undefined));
      },
    },
    ...colors.map((color): MenuEntry => ({
      label: t(`canvasColor${color}`),
      run: () => {
        change((canvas) => setColor(canvas, id, color));
      },
    })),
  ];

  /** A card's or an arrow's menu. */
  const menuEntries = (id: string): MenuEntry[] => {
    const node = saved?.nodes.find((each) => each.id === id);
    const edge = saved?.edges.find((each) => each.id === id);
    if (edge !== undefined) {
      return [
        {
          label: t("canvasEditLabel"),
          run: () => {
            setLabelling(id);
          },
        },
        "separator",
        ...colorEntries(id),
        "separator",
        {
          label: t("canvasRemoveArrow"),
          danger: true,
          run: () => {
            remove([id]);
          },
        },
      ];
    }
    if (node === undefined) return [];
    return [
      ...(node.type === "group"
        ? [
            {
              label: t("canvasRenameGroup"),
              run: () => {
                setNaming(id);
              },
            },
          ]
        : []),
      ...(node.type === "text"
        ? [
            {
              label: t("canvasEditText"),
              run: () => {
                setEditing(id);
              },
            },
          ]
        : []),
      {
        label: t("canvasConnect"),
        run: () => {
          setConnecting({ from: id, at: menu?.at ?? { x: 0, y: 0 } });
        },
      },
      "separator",
      ...colorEntries(id),
      "separator",
      {
        label: t("canvasRemoveCard"),
        danger: true,
        run: () => {
          remove([id]);
        },
      },
    ];
  };

  const title = nameOf(path);
  if (loaded !== undefined && "error" in loaded) {
    return (
      <div className="canvas-view">
        <h1 className="canvas-title">{title}</h1>
        <p role="alert">{loaded.error}</p>
      </div>
    );
  }

  const selectedEdge = (id: string) => selected.has(id);
  const connectLine = (() => {
    if (gesture?.kind !== "connect") return undefined;
    const from = boxes.get(gesture.from);
    if (from === undefined) return undefined;
    const start = sidePoint(from, gesture.side);
    return `M ${String(start.x)} ${String(start.y)} L ${String(gesture.to.x)} ${String(gesture.to.y)}`;
  })();

  return (
    <div className="canvas-view" onKeyDown={onViewKeyDown}>
      <div className="canvas-toolbar">
        <h1 className="canvas-title">{title}</h1>
        {editable ? (
          <div className="canvas-tools" role="group" aria-label={t("canvasAdd")}>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                addText(middle());
              }}
            >
              {t("canvasAddText")}
            </button>
            <button
              type="button"
              className="quiet"
              aria-haspopup="dialog"
              onClick={() => {
                setPickingNote(true);
              }}
            >
              {t("canvasAddNote")}
            </button>
            <button
              type="button"
              className="quiet"
              aria-haspopup="dialog"
              onClick={() => {
                setLinking(true);
              }}
            >
              {t("canvasAddLink")}
            </button>
            <button type="button" className="quiet" onClick={addGroup}>
              {t("canvasAddGroup")}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={history === undefined || history.past.length === 0}
              aria-keyshortcuts="Control+Z Meta+Z"
              onClick={() => {
                step(true);
              }}
            >
              {t("undo")}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={history === undefined || history.future.length === 0}
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
              onClick={() => {
                step(false);
              }}
            >
              {t("redo")}
            </button>
          </div>
        ) : null}
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
      {loaded !== undefined && loaded.problems.length > 0 ? (
        <p className="notice" role="status">
          {t("canvasProblems", { count: String(loaded.problems.length) })}
        </p>
      ) : null}
      {notice === undefined ? null : (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div
        className="canvas-pane"
        ref={pane}
        onPointerDown={onPanePointerDown}
        onDragOver={(event) => {
          if (!editable) return;
          const types = event.dataTransfer.types;
          if (types.includes("Files") || types.includes("application/x-nether-path")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={onDrop}
        onDoubleClick={(event) => {
          if (
            !editable ||
            (event.target as Element).closest(".canvas-node:not(.canvas-group)") !== null
          )
            return;
          addText(toCanvas(event.clientX, event.clientY));
        }}
      >
        {shown === undefined || view === undefined ? null : (
          <div
            className="canvas-world"
            style={{
              transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.zoom)})`,
            }}
          >
            <svg className="canvas-edges" aria-hidden="true" width="1" height="1">
              {shown.edges.map((edge) => (
                <EdgeLine
                  key={edge.id}
                  edge={edge}
                  boxes={boxes}
                  selected={selectedEdge(edge.id)}
                  {...(editable
                    ? {
                        onSelect: (event: PointerEvent<SVGPathElement>) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          setSelected(new Set([edge.id]));
                        },
                      }
                    : {})}
                />
              ))}
              {connectLine === undefined ? null : (
                <path d={connectLine} className="canvas-connecting" fill="none" />
              )}
            </svg>
            {shown.nodes.length === 0 ? (
              <p className="placeholder canvas-empty">
                {editable ? t("canvasEmptyEdit") : t("canvasEmpty")}
              </p>
            ) : null}
            <ul className="canvas-nodes" aria-label={t("canvasNodes", { name: title })}>
              {ordered.map((node) => {
                const isSelected = selected.has(node.id);
                return (
                  <li
                    key={node.id}
                    id={`canvas-node-${node.id}`}
                    className={`canvas-node canvas-${node.type}${isSelected ? " selected" : ""}`}
                    tabIndex={0}
                    aria-label={`${t(`canvasKind_${node.type}`)}: ${describe(node)}`}
                    aria-roledescription={t("canvasCard")}
                    aria-keyshortcuts={editable ? "Enter Delete Shift+F10" : undefined}
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
                    onPointerDown={(event) => {
                      onNodePointerDown(event, node);
                    }}
                    onDoubleClick={(event) => {
                      if (node.type !== "text" || !editable) return;
                      event.stopPropagation();
                      setEditing(node.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelected(new Set([node.id]));
                      setMenu({ id: node.id, at: { x: event.clientX, y: event.clientY } });
                    }}
                    onKeyDown={(event) => {
                      onNodeKeyDown(event, node);
                    }}
                    onFocus={() => {
                      if (!selected.has(node.id)) setSelected(new Set([node.id]));
                    }}
                  >
                    {node.type === "group" && node.label !== undefined ? (
                      <span className="canvas-group-label">{node.label}</span>
                    ) : null}
                    {editing === node.id && node.type === "text" ? (
                      <textarea
                        className="canvas-editor"
                        aria-label={t("canvasCardText")}
                        defaultValue={node.text}
                        autoFocus
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (
                            event.key === "Escape" ||
                            ((event.ctrlKey || event.metaKey) && event.key === "Enter")
                          ) {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        onBlur={(event) => {
                          const text = event.currentTarget.value;
                          setEditing(undefined);
                          change((canvas) => setText(canvas, node.id, text));
                          document
                            .getElementById(`canvas-node-${node.id}`)
                            ?.focus({ preventScroll: true });
                        }}
                      />
                    ) : (
                      <CardBody
                        node={node}
                        vault={vault}
                        graph={graph}
                        media={media}
                        from={path}
                        onOpenNote={onOpenNote}
                      />
                    )}
                    {isSelected && editable && editing !== node.id ? (
                      <>
                        {sides.map((side) => (
                          <span
                            key={side}
                            className={`canvas-handle canvas-handle-${side}`}
                            aria-hidden="true"
                            onPointerDown={(event) => {
                              onHandlePointerDown(event, node, side);
                            }}
                          />
                        ))}
                        <span
                          className="canvas-resize"
                          aria-hidden="true"
                          onPointerDown={(event) => {
                            onResizePointerDown(event, node);
                          }}
                        />
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {shown === undefined || shown.edges.length === 0 ? null : (
          <ul className="canvas-edge-list" aria-label={t("canvasEdges")}>
            {shown.edges.map((edge) => (
              <li key={edge.id}>
                <button
                  type="button"
                  className="quiet"
                  aria-haspopup="menu"
                  onClick={(event) => {
                    setSelected(new Set([edge.id]));
                    setMenu({ id: edge.id, at: pointBelow(event.currentTarget) });
                  }}
                >
                  {t(edge.label === undefined ? "canvasEdge" : "canvasEdgeLabelled", {
                    from: describe(boxes.get(edge.fromNode)),
                    to: describe(boxes.get(edge.toNode)),
                    label: edge.label ?? "",
                  })}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {menu === undefined || !editable ? null : (
        <ContextMenu
          label={t("canvasCardMenu", { name: describe(boxes.get(menu.id)) || t("canvasArrow") })}
          at={menu.at}
          entries={menuEntries(menu.id)}
          onClose={() => {
            setMenu(undefined);
          }}
        />
      )}
      {connecting === undefined || saved === undefined ? null : (
        <ContextMenu
          label={t("canvasConnectTo")}
          at={connecting.at}
          entries={readingOrder(saved.nodes)
            .filter((node) => node.id !== connecting.from)
            .map((node): MenuEntry => ({
              label: describe(node),
              run: () => {
                const from = boxes.get(connecting.from);
                const sidesOf = from === undefined ? undefined : facingSides(from, node);
                change((canvas) =>
                  connect(
                    canvas,
                    { id: newCanvasId(canvasIds(canvas)), from: connecting.from, to: node.id },
                    sidesOf === undefined ? {} : { fromSide: sidesOf.from, toSide: sidesOf.to },
                  ),
                );
              },
            }))}
          onClose={() => {
            // The card connected keeps the focus, as its menu opened from it.
            const from = connecting.from;
            setConnecting(undefined);
            requestAnimationFrame(() => {
              document.getElementById(`canvas-node-${from}`)?.focus({ preventScroll: true });
            });
          }}
        />
      )}
      {labelling === undefined ? null : (
        <TextPromptDialog
          title={t("canvasEditLabel")}
          label={t("canvasLabel")}
          value={saved?.edges.find((edge) => edge.id === labelling)?.label ?? ""}
          onSubmit={(label) => {
            change((canvas) => setLabel(canvas, labelling, label));
          }}
          onClose={() => {
            setLabelling(undefined);
          }}
        />
      )}
      {naming === undefined ? null : (
        <TextPromptDialog
          title={t("canvasRenameGroup")}
          label={t("canvasGroupName")}
          value={(() => {
            const group = saved?.nodes.find((node) => node.id === naming);
            return group?.type === "group" ? (group.label ?? "") : "";
          })()}
          onSubmit={(label) => {
            change((canvas) =>
              updateNode(canvas, naming, (node) => {
                if (node.type !== "group") return node;
                if (label !== "") return { ...node, label };
                const rest: { -readonly [Key in keyof typeof node]: (typeof node)[Key] } = {
                  ...node,
                };
                delete rest.label;
                return rest;
              }),
            );
          }}
          onClose={() => {
            setNaming(undefined);
          }}
        />
      )}
      {linking ? (
        <TextPromptDialog
          title={t("canvasAddLink")}
          label={t("canvasLinkAddress")}
          value="https://"
          check={(value) => {
            try {
              return /^https?:$/.test(new URL(value).protocol) ? undefined : t("canvasLinkInvalid");
            } catch {
              return t("canvasLinkInvalid");
            }
          }}
          onSubmit={(url) => {
            const at = middle();
            add({
              type: "link",
              url,
              x: snap(at.x - 200, 10),
              y: snap(at.y - 60, 10),
              width: 400,
              height: 120,
            });
          }}
          onClose={() => {
            setLinking(false);
          }}
        />
      ) : null}
      {pickingNote ? (
        <QuickSwitcher
          vault={vault}
          graph={graph}
          label={t("canvasAddNote")}
          onOpen={(id) => {
            const note = vault.note(id);
            if (note === undefined) return;
            const at = middle();
            add({
              type: "file",
              file: note.path,
              x: snap(at.x - 200, 10),
              y: snap(at.y - 150, 10),
              width: 400,
              height: 300,
            });
          }}
          onClose={() => {
            setPickingNote(false);
          }}
        />
      ) : null}
    </div>
  );
}
