// The vault's notes as a tree in the sidebar: the file tree or the page
// tree. It draws only the rows in view, as the list does, and works as a
// tree does: the arrow keys move between rows and open and close them, and
// Enter opens a note. A note or folder dragged onto a folder or a page, or
// onto the space below the rows, moves there; the + beside a folder or a
// page makes a note in it. A right click on a note, or the menu key, opens
// its menu. What is open is remembered for the vault.
import type { NoteId } from "@nether/core";
import { type NoteEntry, folderOf } from "@nether/storage";
import { type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { type MenuPoint, isMenuKey, pointBelow } from "./ContextMenu.tsx";
import { t } from "./messages.ts";
import { type TreeNode, type TreeRow, folderTree, pageTree, pathTo, visibleRows } from "./tree.ts";

const rowHeight = 28;
const overscan = 8;
const indent = 14;
const dragType = "application/x-nether-path";

/** What is dragged: a note by its path, or a folder. */
export interface Dragged {
  readonly kind: "note" | "folder";
  readonly path: string;
}

function readStored(key: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function store(key: string, expanded: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...expanded]));
  } catch {
    // Not remembered: what is open holds until the app closes.
  }
}

function nameOf(node: TreeNode): string {
  return node.kind === "folder" ? node.name : node.note.title;
}

/** The folder a drop on a row puts things in: the folder, a page's pages, or a note's folder. */
function dropFolder(node: TreeNode, mode: "folders" | "pages"): string {
  if (node.kind === "folder") return node.path;
  return mode === "pages" ? node.note.path.replace(/\.md$/i, "") : folderOf(node.note.path);
}

/** Whether a drop would move something into itself, or where it already is. */
function pointless(dragged: Dragged, folder: string): boolean {
  const own = dragged.kind === "folder" ? dragged.path : dragged.path.replace(/\.md$/i, "");
  return folder === own || folder.startsWith(`${own}/`) || folderOf(dragged.path) === folder;
}

const noFolders: readonly string[] = [];

export function NoteTree(props: {
  readonly notes: readonly NoteEntry[];
  readonly mode: "folders" | "pages";
  readonly selected: NoteId | undefined;
  readonly onSelect: (id: NoteId) => void;
  /** Moves a note, with its pages, or a folder, into a folder; "" is the vault's top. */
  readonly onMove: (dragged: Dragged, folder: string) => void;
  /** Makes a note in a folder; "" is the vault's top. */
  readonly onNewIn: (folder: string) => void;
  /** Opens a note's menu at a point. */
  readonly onMenu?: (id: NoteId, at: MenuPoint) => void;
  /** Folders no note is in, which show too. */
  readonly folders?: readonly string[];
  /** Opens a folder's menu at a point. */
  readonly onFolderMenu?: (path: string, at: MenuPoint) => void;
  /** The folder whose menu is open, which shows so. */
  readonly folderMenuFor?: string | undefined;
  /** Opens a note in a new tab: Ctrl or Cmd and a click, or a middle click. */
  readonly onOpenInNewTab?: (id: NoteId) => void;
  /** The note whose menu is open, which shows so. */
  readonly menuFor?: NoteId | undefined;
  readonly label: string;
  /** Where the tree remembers what is open, for its vault and view. */
  readonly storageKey: string;
}) {
  const {
    notes,
    mode,
    selected,
    onSelect,
    onMove,
    onNewIn,
    onMenu,
    folders = noFolders,
    onFolderMenu,
    folderMenuFor,
    onOpenInNewTab,
    menuFor,
    label,
    storageKey,
  } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => readStored(storageKey));
  const [focusKey, setFocusKey] = useState<string | undefined>();
  const [dropKey, setDropKey] = useState<string | undefined>();
  const roots = useMemo(
    () => (mode === "pages" ? pageTree(notes, folders) : folderTree(notes, folders)),
    [notes, folders, mode],
  );
  const rows = useMemo(() => visibleRows(roots, expanded), [roots, expanded]);

  useEffect(() => {
    setExpanded(readStored(storageKey));
  }, [storageKey]);

  const change = (next: ReadonlySet<string>) => {
    setExpanded(next);
    store(storageKey, next);
  };

  // The selected note shows, its folders or pages open.
  useEffect(() => {
    if (selected === undefined) return;
    const trail = pathTo(roots, selected);
    if (trail.every((key) => expanded.has(key))) return;
    change(new Set([...expanded, ...trail]));
  }, [selected, roots]);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const measure = () => {
      setView({ top: element.scrollTop, height: element.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, []);

  const selectedKey = rows.find((row) => row.node.kind === "note" && row.node.note.id === selected)
    ?.node.key;
  const current =
    focusKey !== undefined && rows.some((row) => row.node.key === focusKey)
      ? focusKey
      : (selectedKey ?? rows[0]?.node.key);
  const index = rows.findIndex((row) => row.node.key === current);

  const toggle = (row: TreeRow) => {
    if (row.node.children.length === 0) return;
    const next = new Set(expanded);
    if (row.expanded) next.delete(row.node.key);
    else next.add(row.node.key);
    change(next);
  };

  const focusRow = (next: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, next))];
    if (row === undefined) return;
    setFocusKey(row.node.key);
    const element = scroller.current;
    const at = rows.indexOf(row) * rowHeight;
    if (element !== null) {
      if (at < element.scrollTop) element.scrollTop = at;
      else if (at + rowHeight > element.scrollTop + element.clientHeight) {
        element.scrollTop = at + rowHeight - element.clientHeight;
      }
    }
    // Focus follows once the row is drawn.
    requestAnimationFrame(() => {
      scroller.current
        ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.node.key)}"]`)
        ?.focus();
    });
  };

  const open = (row: TreeRow) => {
    if (row.node.kind === "note") onSelect(row.node.note.id);
    else toggle(row);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const row = rows[index];
    if (row === undefined) return;
    if (isMenuKey(event)) {
      const element = scroller.current?.querySelector(`[data-key="${CSS.escape(row.node.key)}"]`);
      const at = element == null ? { x: 0, y: 0 } : pointBelow(element);
      if (row.node.kind === "note" && onMenu !== undefined) onMenu(row.node.note.id, at);
      else if (row.node.kind === "folder" && onFolderMenu !== undefined) {
        onFolderMenu(row.node.path, at);
      } else return;
      event.preventDefault();
      return;
    }
    const page = Math.max(1, Math.floor(view.height / rowHeight) - 1);
    // Right to left, the tree opens towards the left, and so do the arrows.
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const key = rtl
      ? ({ ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" }[event.key] ?? event.key)
      : event.key;
    switch (key) {
      case "ArrowDown":
        focusRow(index + 1);
        break;
      case "ArrowUp":
        focusRow(index - 1);
        break;
      case "PageDown":
        focusRow(index + page);
        break;
      case "PageUp":
        focusRow(index - page);
        break;
      case "Home":
        focusRow(0);
        break;
      case "End":
        focusRow(rows.length - 1);
        break;
      case "ArrowRight":
        if (row.node.children.length === 0) return;
        if (row.expanded) focusRow(index + 1);
        else toggle(row);
        break;
      case "ArrowLeft":
        if (row.expanded) toggle(row);
        else if (row.parent !== undefined) {
          focusRow(rows.findIndex((other) => other.node.key === row.parent));
        }
        break;
      case "Enter":
      case " ":
        open(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const dragged = (event: DragEvent): Dragged | undefined => {
    try {
      const data: unknown = JSON.parse(event.dataTransfer.getData(dragType));
      if (typeof data !== "object" || data === null) return undefined;
      const { kind, path } = data as Record<string, unknown>;
      return (kind === "note" || kind === "folder") && typeof path === "string"
        ? { kind, path }
        : undefined;
    } catch {
      return undefined;
    }
  };

  const allowDrop = (event: DragEvent, key: string) => {
    if (!event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropKey(key);
  };

  const drop = (event: DragEvent, folder: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropKey(undefined);
    const item = dragged(event);
    if (item !== undefined && !pointless(item, folder)) onMove(item, folder);
  };

  const first = Math.max(0, Math.floor(view.top / rowHeight) - overscan);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / rowHeight) + overscan);

  return (
    <div
      className={`note-tree${dropKey === "" ? " drop-target" : ""}`}
      ref={scroller}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        allowDrop(event, "");
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropKey(undefined);
      }}
      onDrop={(event) => {
        drop(event, "");
      }}
    >
      <div role="tree" aria-label={label} style={{ height: rows.length * rowHeight }}>
        {rows.slice(first, last).map((row, offset) => {
          const position = first + offset;
          const { node } = row;
          const isSelected = node.kind === "note" && node.note.id === selected;
          const target = dropFolder(node, mode);
          return (
            <div
              key={node.key}
              role="treeitem"
              data-key={node.key}
              className={`tree-row${dropKey === node.key ? " drop-target" : ""}${
                (node.kind === "note" && node.note.id === menuFor) ||
                (node.kind === "folder" && node.path === folderMenuFor)
                  ? " menu-open"
                  : ""
              }`}
              style={{ top: position * rowHeight, height: rowHeight }}
              aria-level={row.depth + 1}
              aria-setsize={row.siblings}
              aria-posinset={row.position + 1}
              aria-expanded={node.children.length > 0 ? row.expanded : undefined}
              aria-selected={isSelected}
              aria-current={isSelected ? "page" : undefined}
              tabIndex={node.key === current ? 0 : -1}
              title={node.kind === "folder" ? node.path : node.note.path}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  dragType,
                  JSON.stringify({
                    kind: node.kind,
                    path: node.kind === "folder" ? node.path : node.note.path,
                  } satisfies Dragged),
                );
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                allowDrop(event, node.key);
              }}
              onDrop={(event) => {
                drop(event, target);
              }}
              onClick={(event) => {
                setFocusKey(node.key);
                if (
                  node.kind === "note" &&
                  onOpenInNewTab !== undefined &&
                  (event.ctrlKey || event.metaKey)
                ) {
                  onOpenInNewTab(node.note.id);
                  return;
                }
                open(row);
              }}
              onAuxClick={(event) => {
                if (event.button !== 1 || node.kind !== "note" || onOpenInNewTab === undefined) {
                  return;
                }
                event.preventDefault();
                onOpenInNewTab(node.note.id);
              }}
              onContextMenu={(event) => {
                const at = { x: event.clientX, y: event.clientY };
                if (node.kind === "note" && onMenu !== undefined) onMenu(node.note.id, at);
                else if (node.kind === "folder" && onFolderMenu !== undefined) {
                  onFolderMenu(node.path, at);
                } else return;
                event.preventDefault();
                setFocusKey(node.key);
              }}
            >
              <span className="tree-indent" style={{ width: row.depth * indent }} />
              <span
                className="tree-toggle"
                aria-hidden="true"
                onClick={(event) => {
                  if (node.kind === "note" && node.children.length > 0) {
                    event.stopPropagation();
                    toggle(row);
                  }
                }}
              >
                {node.children.length === 0 ? "" : row.expanded ? "▾" : "▸"}
              </span>
              <span className={node.kind === "folder" ? "tree-folder" : "note-title"}>
                {nameOf(node)}
              </span>
              {node.kind === "folder" || mode === "pages" ? (
                <button
                  type="button"
                  className="tree-add"
                  tabIndex={-1}
                  aria-label={t("newNoteIn", { name: nameOf(node) })}
                  title={t("newNoteIn", { name: nameOf(node) })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewIn(target);
                  }}
                >
                  +
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
