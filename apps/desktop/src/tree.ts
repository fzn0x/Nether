// The vault's notes as trees for the sidebar. The file tree shows folders
// and the notes in them. The page tree shows notes in notes: a note's pages
// are the notes in the folder beside it with its name, `Plan/` beside
// `Plan.md`, as Notion exports pages; a folder no note names shows as a
// folder. Both are made from the notes' paths alone, so they always agree.
import type { NoteEntry } from "@nether/storage";

export type TreeNode =
  | {
      readonly kind: "folder";
      readonly key: string;
      readonly path: string;
      readonly name: string;
      readonly children: readonly TreeNode[];
    }
  | {
      readonly kind: "note";
      readonly key: string;
      readonly note: NoteEntry;
      /** Its pages, in the page tree; none in the file tree. */
      readonly children: readonly TreeNode[];
    };

/** A row of the tree as shown: a node, how deep, and where among its siblings. */
export interface TreeRow {
  readonly node: TreeNode;
  readonly depth: number;
  readonly expanded: boolean;
  /** The key of the node it is in, if any. */
  readonly parent: string | undefined;
  readonly position: number;
  readonly siblings: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function nameOf(node: TreeNode): string {
  return node.kind === "folder" ? node.name : node.note.title;
}

export function folderKey(path: string): string {
  return `f:${path}`;
}

export function noteKey(note: NoteEntry): string {
  return `n:${note.id}`;
}

interface Building {
  readonly path: string;
  readonly name: string;
  readonly folders: Map<string, Building>;
  readonly notes: NoteEntry[];
}

function building(path: string): Building {
  return { path, name: path.slice(path.lastIndexOf("/") + 1), folders: new Map(), notes: [] };
}

/** Folders first, then notes, each by name as a file explorer sorts them. */
function folderChildren(folder: Building): TreeNode[] {
  const folders = [...folder.folders.values()]
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((child): TreeNode => ({
      kind: "folder",
      key: folderKey(child.path),
      path: child.path,
      name: child.name,
      children: folderChildren(child),
    }));
  const notes = [...folder.notes]
    .sort((a, b) => collator.compare(a.title, b.title))
    .map((note): TreeNode => ({ kind: "note", key: noteKey(note), note, children: [] }));
  return [...folders, ...notes];
}

function root(notes: readonly NoteEntry[]): Building {
  const top = building("");
  for (const note of notes) {
    let folder = top;
    const parts = note.path.split("/").slice(0, -1);
    for (const [index, part] of parts.entries()) {
      const path = parts.slice(0, index + 1).join("/");
      let next = folder.folders.get(part);
      if (next === undefined) {
        next = building(path);
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.notes.push(note);
  }
  return top;
}

/** The file tree: folders, then notes, at each level. */
export function folderTree(notes: readonly NoteEntry[]): readonly TreeNode[] {
  return folderChildren(root(notes));
}

/** The page tree: a folder beside a note with its name holds the note's pages. */
export function pageTree(notes: readonly NoteEntry[]): readonly TreeNode[] {
  const pages = (children: readonly TreeNode[]): TreeNode[] => {
    const byPath = new Map<string, TreeNode & { kind: "note" }>();
    for (const child of children) {
      if (child.kind === "note")
        byPath.set(child.note.path.replace(/\.md$/i, "").toLowerCase(), child);
    }
    const kept: TreeNode[] = [];
    const childrenOf = new Map<string, readonly TreeNode[]>();
    for (const child of children) {
      if (child.kind === "folder") {
        const page = byPath.get(child.path.toLowerCase());
        if (page !== undefined) {
          childrenOf.set(page.key, pages(child.children));
          continue;
        }
        kept.push({ ...child, children: pages(child.children) });
      } else {
        kept.push(child);
      }
    }
    return kept
      .map((node) => {
        const own = childrenOf.get(node.key);
        return own === undefined ? node : { ...node, children: own };
      })
      .sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
  };
  return pages(folderTree(notes));
}

/** The rows shown: every node whose parents are all expanded, in order. */
export function visibleRows(roots: readonly TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (nodes: readonly TreeNode[], depth: number, parent: string | undefined) => {
    for (const [position, node] of nodes.entries()) {
      const open = node.children.length > 0 && expanded.has(node.key);
      rows.push({ node, depth, expanded: open, parent, position, siblings: nodes.length });
      if (open) visit(node.children, depth + 1, node.key);
    }
  };
  visit(roots, 0, undefined);
  return rows;
}

/** The keys of the nodes a note is in, outermost first, to show it. */
export function pathTo(roots: readonly TreeNode[], note: string): string[] {
  const search = (nodes: readonly TreeNode[], trail: string[]): string[] | undefined => {
    for (const node of nodes) {
      if (node.kind === "note" && node.note.id === note) return trail;
      const found = search(node.children, [...trail, node.key]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return search(roots, []) ?? [];
}
