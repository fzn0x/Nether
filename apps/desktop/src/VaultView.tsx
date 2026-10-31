// An open vault: its notes, or its tags, on the left, and the selected note
// in the editor on the right. A tag shows the notes with it. New notes are
// made blank or from a template, and today's, this week's and this month's
// notes open, made the first time from theirs.
import type { NoteId, Period } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import type { NoteEntry } from "@nether/storage";
import {
  type CSSProperties,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Indexer } from "./indexer.ts";
import { t } from "./messages.ts";
import type { VaultInfo } from "./mygo.ts";
import { backend } from "./backend.ts";
import { BookmarkList } from "./BookmarkList.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { ContextMenu, type MenuEntry, type MenuPoint } from "./ContextMenu.tsx";
import { type Menu, MenuBar } from "./MenuBar.tsx";
import { IconButton } from "./IconButton.tsx";
import { commandIcons, itemIcons, menuIcons } from "./icons.ts";
import { NewFolderDialog } from "./NewFolderDialog.tsx";
import { SidebarResizer, useSidebarWidth } from "./SidebarResizer.tsx";
import { type CommandId, commandIds, defaultHotkeys } from "./commands.ts";
import { ExportDialog } from "./ExportDialog.tsx";
import { MergeNoteDialog } from "./MergeNoteDialog.tsx";
import { MoveNoteDialog } from "./MoveNoteDialog.tsx";
import { NewNoteDialog } from "./NewNoteDialog.tsx";
import { copyNote, fullPath, vaultFolders } from "./noteActions.ts";
import { NoteTagsDialog } from "./NoteTagsDialog.tsx";
import { NoteList } from "./NoteList.tsx";
import { type Dragged, NoteTree } from "./NoteTree.tsx";
import { QuickSwitcher } from "./QuickSwitcher.tsx";
import { RenameNoteDialog } from "./RenameNoteDialog.tsx";
import { TabStrip } from "./TabStrip.tsx";
import {
  type Layout,
  activeNote,
  chooseTab,
  closeNote,
  closeTab,
  cycleTab,
  emptyLayout,
  focusPane,
  openHere,
  openInNewTab,
  openToTheRight,
  readLayout,
  replaceNote,
  shownIn,
} from "./tabs.ts";
import { SearchPanel } from "./SearchPanel.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { ariaKeys, commandFor, eventKeys } from "./shortcuts.ts";
import { TemplateSettingsDialog } from "./TemplateSettingsDialog.tsx";

import { useAppearance } from "./useAppearance.ts";
import { useBookmarks } from "./useBookmarks.ts";
import { TrashPanel } from "./TrashPanel.tsx";
import type { NotePart } from "./noteLinks.ts";
import type { NoteMode } from "./NoteView.tsx";
import { findTemplate, nameOf, periodicNote, periods, templateChoices } from "./templates.ts";
import { useGraph } from "./useGraph.ts";
import { syncSummary } from "./sync.ts";
import { useHotkeys } from "./useHotkeys.ts";
import { useTemplateSettings } from "./useTemplateSettings.ts";
import { useSync } from "./useSync.ts";
import { usePeople, useNotifications } from "./useNotifications.ts";
import { queueMention } from "./notify.ts";
import { useFolders, useNotes, useVault } from "./useVault.ts";

// The editor and the Markdown parser load on their own, so the vault's notes
// show while they do. Not through lazy(): a lazy component waits on its
// first render even when its code has loaded, and React then holds back
// what it waited for a further 300 ms, as it does after any fallback.
type NoteViewModule = typeof import("./NoteView.tsx");
let noteViewModule: NoteViewModule | undefined;
const loadNoteView = () => import("./NoteView.tsx").then((module) => (noteViewModule = module));

/** The note view's code, loading as the vault opens, before a note is picked. */
function useNoteViewModule(): NoteViewModule | undefined {
  const [module, setModule] = useState(noteViewModule);
  useEffect(() => {
    if (module !== undefined) return;
    let current = true;
    void loadNoteView().then((loaded) => {
      if (current) setModule(loaded);
    });
    return () => {
      current = false;
    };
  }, [module]);
  return module;
}
// Making a note from a template takes the editor's document and the parser.
const loadCreateNote = () => import("./createNote.ts");
// Renaming a note reads the links to it with the parser.
const loadRenameNote = () => import("./renameNote.ts");
const loadMergeNote = () => import("./mergeNote.ts");
// So does making a database, which writes its note's frontmatter.
const loadDatabases = () => import("./databases.ts");
// The graph, with Sigma and its layout, loads the first time it opens.
const GraphView = lazy(() => import("./GraphView.tsx"));
// The import, appearance and servers dialogs, with the importers, load when they open.
const ImportDialog = lazy(() =>
  import("./ImportDialog.tsx").then(({ ImportDialog: dialog }) => ({ default: dialog })),
);
const AppearanceDialog = lazy(() =>
  import("./AppearanceDialog.tsx").then(({ AppearanceDialog: dialog }) => ({ default: dialog })),
);
const ServersDialog = lazy(() =>
  import("./ServersDialog.tsx").then(({ ServersDialog: dialog }) => ({ default: dialog })),
);
const SyncDialog = lazy(() =>
  import("./SyncDialog.tsx").then(({ SyncDialog: dialog }) => ({ default: dialog })),
);
const SpacesDialog = lazy(() =>
  import("./SpacesDialog.tsx").then(({ SpacesDialog: dialog }) => ({ default: dialog })),
);
const ShareDialog = lazy(() =>
  import("./ShareDialog.tsx").then(({ ShareDialog: dialog }) => ({ default: dialog })),
);
const MembersDialog = lazy(() =>
  import("./MembersDialog.tsx").then(({ MembersDialog: dialog }) => ({ default: dialog })),
);
const HistoryDialog = lazy(() =>
  import("./HistoryDialog.tsx").then(({ HistoryDialog: dialog }) => ({ default: dialog })),
);
const NotificationsDialog = lazy(() =>
  import("./NotificationsDialog.tsx").then(({ NotificationsDialog: dialog }) => ({
    default: dialog,
  })),
);

const numbers = new Intl.NumberFormat();

type NotesView = "folders" | "pages" | "list";
const notesViews: readonly NotesView[] = ["folders", "pages", "list"];
const viewKey = "nether.notesView";

/** How the sidebar shows notes, as the user last chose; storage may be closed to the page. */
function storedView(): NotesView {
  try {
    const stored = localStorage.getItem(viewKey);
    return notesViews.find((view) => view === stored) ?? "folders";
  } catch {
    return "folders";
  }
}

function storeView(view: NotesView): void {
  try {
    localStorage.setItem(viewKey, view);
  } catch {
    // Not remembered: the view holds until the app closes.
  }
}

/** How far the link index has read, while it is reading. */
function IndexStatus(props: { readonly indexer: Indexer }) {
  const { indexer } = props;
  const progress = useSyncExternalStore(
    (listener) => indexer.subscribe(listener),
    () => indexer.progress(),
  );
  const error = useSyncExternalStore(
    (listener) => indexer.subscribe(listener),
    () => indexer.error(),
  );
  if (error !== undefined) {
    return (
      <p className="count" role="alert">
        {t("linksFailed", { error })}
      </p>
    );
  }
  if (progress.done >= progress.total) return null;
  return (
    <p className="count" role="status">
      {t("indexingLinks", {
        done: numbers.format(progress.done),
        total: numbers.format(progress.total),
      })}
    </p>
  );
}

/** The vault's tags, nested ones under theirs, with how many notes have each. */
function TagList(props: { readonly graph: LinkGraph; readonly onSelect: (tag: string) => void }) {
  const { graph, onSelect } = props;
  const version = useGraph(graph);
  const tags = useMemo(() => graph.tags(), [graph, version]);
  if (tags.length === 0) return <p className="placeholder">{t("noTags")}</p>;
  return (
    <ul className="tag-list" aria-label={t("tags")}>
      {tags.map(({ tag, count }) => {
        const depth = tag.split("/").length - 1;
        return (
          <li key={tag.toLowerCase()} style={{ paddingInlineStart: `${String(depth)}rem` }}>
            <button
              type="button"
              onClick={() => {
                onSelect(tag);
              }}
            >
              <span className="tag-name">
                #{depth === 0 ? tag : tag.slice(tag.lastIndexOf("/") + 1)}
              </span>
              <span className="tag-count">{numbers.format(count)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What a pane asks of the note it shows: blocks or source, kept from note
 * to note; where a link to a heading or block asked to go; and counters
 * that change to ask it to switch modes, take a new name, comment on its
 * selection, or show a thread a notification opened.
 */
interface PaneAsks {
  readonly mode: NoteMode;
  readonly focus?: (NotePart & { readonly key: number }) | undefined;
  readonly source: number;
  readonly rename: number;
  readonly comment: number;
  readonly thread?: { readonly thread: string; readonly key: number } | undefined;
}

const noAsks: PaneAsks = { mode: "blocks", source: 0, rename: 0, comment: 0 };

export function VaultView(props: {
  readonly info: VaultInfo;
  /** The note to open first, by its path, as the command line names one; else the last open. */
  readonly note?: string;
  readonly onClose: () => void;
}) {
  const { info, note: startNote, onClose } = props;
  const state = useVault(info);
  const vault = state.status === "open" ? state.vault : undefined;
  const sync = useSync(vault);
  const notifications = useNotifications(vault, sync.link);
  const people = usePeople(sync.link);
  // The vault's light or dark, theme and snippets, on the page while it is open.
  const appearance = useAppearance(vault);
  const graph = state.status === "open" ? state.indexer.graph : undefined;
  const notes = useNotes(vault);
  const folders = useFolders(vault);
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const bookmarks = useBookmarks(vault);
  // Where notes are open: tabs in one pane or two (ADR 0046). Commands
  // about a note act on the note the focused pane shows.
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  const layoutNow = useRef(layout);
  const changeLayout = useCallback((change: (current: Layout) => Layout): Layout => {
    const next = change(layoutNow.current);
    layoutNow.current = next;
    setLayout(next);
    return next;
  }, []);
  const selected = activeNote(layout);
  // Whether the graph shows in place of the note.
  const [graphShown, setGraphShown] = useState(false);
  const lastNoteKey = `nether.lastNote.${info.id}`;
  const tabsKey = `nether.tabs.${info.id}`;

  // The vault's links load once the note it opens to shows, or at once when
  // it opens to none: loaded alongside it, they held that note back.
  const indexer = state.status === "open" ? state.indexer : undefined;
  const linksStarted = useRef<Indexer | undefined>(undefined);
  const loadLinks = useCallback(() => {
    if (indexer === undefined || linksStarted.current === indexer) return;
    linksStarted.current = indexer;
    void (async () => {
      await indexer.start();
      backend.mark("links-loaded");
      // Then the notes the index has not read, all of them the first time.
      await indexer.idle();
      backend.mark("notes-read");
      // Opening the vault is done, and what it took to open it can go.
      backend.settle();
    })();
  }, [indexer]);
  useEffect(() => {
    // Should the note never show.
    const timer = setTimeout(loadLinks, 3000);
    return () => {
      clearTimeout(timer);
    };
  }, [loadLinks]);

  // What each pane, by its key, asks of the note it shows.
  const [asks, setAsks] = useState<Readonly<Record<number, PaneAsks>>>({});
  const ask = useCallback((key: number, change: (current: PaneAsks) => PaneAsks) => {
    setAsks((all) => ({ ...all, [key]: change(all[key] ?? noAsks) }));
  }, []);
  const focusedKey = layout.panes[layout.focused]?.key ?? 0;
  const mode = (asks[focusedKey] ?? noAsks).mode;
  const [panel, setPanel] = useState<"notes" | "tags" | "search" | "trash">("notes");
  const [switcher, setSwitcher] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [tag, setTag] = useState<string | undefined>();
  const [dialog, setDialog] = useState<
    | "newNote"
    | "settings"
    | "appearance"
    | "servers"
    | "sync"
    | "members"
    | "spaces"
    | "share"
    | "notifications"
    | "history"
    | "export"
    | "import"
    | "palette"
    | "shortcuts"
    | undefined
  >();
  // A note's menu, open at a point, and the dialog one of its items opened for a note.
  const [menu, setMenu] = useState<{ readonly id: NoteId; readonly at: MenuPoint } | undefined>();
  const [noteDialog, setNoteDialog] = useState<
    { readonly kind: "rename" | "move" | "merge" | "tags"; readonly id: NoteId } | undefined
  >();
  const { hotkeys, chosen: chosenHotkeys, save: saveHotkeys } = useHotkeys(vault);
  // Whether the app updates itself, and checks on its own.
  const [updates, setUpdates] = useState({ available: false, automatic: false });
  const readUpdates = useCallback(() => {
    backend.updateSettings().then(setUpdates, () => undefined);
  }, []);
  useEffect(readUpdates, [readUpdates]);
  // While the shortcuts dialog listens for keys, they run no command.
  const listening = useRef(false);
  const setListening = useCallback((value: boolean) => {
    listening.current = value;
  }, []);
  // The folder a new note goes in, when made from the tree.
  const [newIn, setNewIn] = useState("");
  // The folder a new folder goes in, while its dialog is open.
  const [newFolderIn, setNewFolderIn] = useState<string | undefined>();
  // A folder's menu, open at a point.
  const [folderMenu, setFolderMenu] = useState<
    { readonly path: string; readonly at: MenuPoint } | undefined
  >();
  const [notesView, setNotesView] = useState<NotesView>(storedView);
  // What happened to a note: a template the vault no longer has, or the note moved to the trash.
  const [notice, setNotice] = useState<
    { readonly text: string; readonly restore?: string } | undefined
  >();
  const { settings, save } = useTemplateSettings(vault);
  const version = useGraph(graph);

  const noteView = useNoteViewModule();

  /** Opens a note in the focused pane's tab, in a new tab, or in the pane to the right; returns that pane's key. */
  const openNote = useCallback(
    (id: NoteId, part?: NotePart, where: "here" | "tab" | "right" = "here"): number => {
      setGraphShown(false);
      const next = changeLayout((current) =>
        where === "tab"
          ? openInNewTab(current, id)
          : where === "right"
            ? openToTheRight(current, id)
            : openHere(current, id),
      );
      const key = next.panes[next.focused]?.key ?? 0;
      const focus =
        part !== undefined && (part.heading !== undefined || part.block !== undefined)
          ? { ...part, key: Date.now() }
          : undefined;
      ask(key, (current) => ({ ...current, focus }));
      return key;
    },
    [changeLayout, ask],
  );

  const showTag = useCallback((name: string) => {
    setTag(name);
    setPanel("notes");
  }, []);

  /** Makes a note at `path`, blank or from a template, and opens it with the cursor where the template puts it. */
  const makeNote = useCallback(
    async (path: string, template: NoteEntry | undefined, date: Date) => {
      if (vault === undefined) return;
      const [{ createNote }, file] = await Promise.all([
        loadCreateNote(),
        template === undefined ? undefined : vault.read(template.id),
      ]);
      const text =
        file === undefined || file.missing === true || file.binary === true ? undefined : file.text;
      const values = {
        title: nameOf(path),
        date,
        now: new Date(),
        dateFormat: settings.dateFormat,
        timeFormat: settings.timeFormat,
      };
      const created = await createNote(
        vault,
        path,
        text === undefined ? undefined : { text, values },
      );
      setTag(undefined);
      setPanel("notes");
      openNote(created.id, created.cursor);
    },
    [vault, settings, openNote],
  );

  /** Opens the note for the day, week or month it is, made from its template the first time. */
  const openPeriodic = useCallback(
    (period: Period) => {
      if (vault === undefined) return;
      setNotice(undefined);
      const { path, date } = periodicNote(settings, period, new Date());
      const existing = vault.noteAt(path);
      if (existing !== undefined) {
        openNote(existing.id);
        return;
      }
      const named = settings[period].template;
      const template = findTemplate(vault.notes(), settings, named);
      if (named !== "" && template === undefined) {
        setNotice({ text: t("templateMissing", { template: named }) });
      }
      makeNote(path, template, date).catch((error: unknown) => {
        setNotice({ text: error instanceof Error ? error.message : String(error) });
      });
    },
    [vault, settings, openNote, makeNote],
  );

  /** Moves a note to the trash, and offers to put it back. */
  const trashNote = useCallback(
    (id: NoteId) => {
      if (vault === undefined) return;
      const title = vault.note(id)?.title ?? "";
      vault.remove(id).then(
        (where) => {
          changeLayout((current) => closeNote(current, id));
          setNotice({ text: t("movedToTrash", { name: title }), restore: where });
        },
        (error: unknown) => {
          setNotice({ text: error instanceof Error ? error.message : String(error) });
        },
      );
    },
    [vault],
  );

  /** Renames a note in its folder, once the link index knows every link to it. */
  const renameCurrent = useCallback(
    async (id: NoteId, name: string) => {
      if (state.status !== "open") return;
      const note = state.vault.note(id);
      if (note === undefined) return;
      const { carryFolder, moveFiles, pageMoves, pagesFolder, renamedPath } =
        await loadRenameNote();
      const target = renamedPath(note.path, name);
      if ("error" in target) {
        throw new Error(target.error === "empty" ? t("noteNameEmpty") : t("noteNameUnsafe"));
      }
      await state.indexer.idle();
      // Its pages, in the folder with its name, follow it.
      await moveFiles(
        state.vault,
        state.indexer.graph,
        pageMoves(state.vault, note.path, target.path),
      );
      await carryFolder(state.vault, pagesFolder(note.path), pagesFolder(target.path));
    },
    [state],
  );

  /** Moves a note, with its pages, or a folder, with the page that names it, into a folder. */
  const moveInTree = useCallback(
    (dragged: Dragged, folder: string) => {
      if (state.status !== "open") return;
      const { vault: open, indexer } = state;
      const name = dragged.path.slice(dragged.path.lastIndexOf("/") + 1);
      const to = folder === "" ? name : `${folder}/${name}`;
      setNotice(undefined);
      void (async () => {
        const { carryFolder, folderMoves, moveFiles, pageMoves, pagesFolder } =
          await loadRenameNote();
        const moves =
          dragged.kind === "note"
            ? pageMoves(open, dragged.path, to)
            : [
                ...folderMoves(open, dragged.path, to),
                ...(open.noteAt(`${dragged.path}.md`) === undefined
                  ? []
                  : [{ from: `${dragged.path}.md`, to: `${to}.md` }]),
              ];
        await indexer.idle();
        await moveFiles(open, indexer.graph, moves);
        // The folder goes too, with the folders in it no note is in.
        if (dragged.kind === "folder") await carryFolder(open, dragged.path, to);
        else await carryFolder(open, pagesFolder(dragged.path), pagesFolder(to));
      })().catch((error: unknown) => {
        setNotice({ text: error instanceof Error ? error.message : String(error) });
      });
    },
    [state],
  );

  const newNoteIn = useCallback((folder: string) => {
    setNewIn(folder);
    setDialog("newNote");
  }, []);

  /** Merges a note into another, which opens in its place when it was open. */
  const mergeInto = useCallback(
    async (id: NoteId, into: NoteEntry) => {
      if (state.status !== "open") return;
      const { vault: open, indexer } = state;
      const name = open.note(id)?.title ?? "";
      setNotice(undefined);
      const { mergeNote } = await loadMergeNote();
      await indexer.idle();
      await mergeNote(open, indexer.graph, id, into.id);
      changeLayout((current) => replaceNote(current, id, into.id));
      setNotice({ text: t("mergedNote", { name, into: into.title }) });
    },
    [state],
  );

  /** Opens a note restored from the trash. */
  const openRestored = useCallback(
    (path: string) => {
      setNotice(undefined);
      const note = vault?.noteAt(path);
      if (note !== undefined) openNote(note.id);
    },
    [vault, openNote],
  );

  const openInTab = useCallback(
    (id: NoteId) => {
      openNote(id, undefined, "tab");
    },
    [openNote],
  );
  const openMenu = useCallback((id: NoteId, at: MenuPoint) => {
    setMenu({ id, at });
  }, []);
  const closeMenu = useCallback(() => {
    setMenu(undefined);
  }, []);
  const openFolderMenu = useCallback((path: string, at: MenuPoint) => {
    setFolderMenu({ path, at });
  }, []);
  const closeFolderMenu = useCallback(() => {
    setFolderMenu(undefined);
  }, []);

  /** Whether the vault has a folder or file at a path, as Windows and macOS compare names. */
  const pathTaken = useCallback(
    (path: string) => {
      const wanted = path.toLowerCase();
      return (
        folders.some((folder) => folder.toLowerCase() === wanted) ||
        (vault?.files().some((file) => file.toLowerCase() === wanted) ?? false)
      );
    },
    [folders, vault],
  );

  /** A folder's menu: notes and folders made in it, and deleting it while it is empty. */
  const folderEntries = (path: string): MenuEntry[] => {
    const inside = (other: string) => other.startsWith(`${path}/`);
    const empty = !notes.some((note) => inside(note.path)) && !folders.some(inside);
    const name = path.slice(path.lastIndexOf("/") + 1);
    return [
      {
        label: t("newNoteHere"),
        icon: itemIcons.newNote,
        run: () => {
          newNoteIn(path);
        },
      },
      {
        label: t("newFolderHere"),
        icon: itemIcons.newFolder,
        run: () => {
          setNewFolderIn(path);
        },
      },
      "separator",
      {
        label: t("deleteFolder"),
        icon: itemIcons.trash,
        danger: true,
        disabled: !empty,
        run: () => {
          vault?.removeFolder(path).then(
            () => {
              setNotice({ text: t("deletedFolder", { name }) });
            },
            () => {
              setNotice({ text: t("folderNotEmpty") });
            },
          );
        },
      },
    ];
  };

  /** Copies text, and says so in the sidebar. */
  const copyText = useCallback((text: string, done: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setNotice({ text: done });
      },
      () => {
        setNotice({ text: t("copyFailed") });
      },
    );
  }, []);

  /** Bookmarks a note, or takes its bookmark away. */
  const toggleBookmark = useCallback(
    (path: string) => {
      bookmarks.toggle(path).catch((error: unknown) => {
        setNotice({ text: error instanceof Error ? error.message : String(error) });
      });
    },
    [bookmarks],
  );

  /** What a note's menu offers: what the app can do with it from the list, without opening it first. */
  const menuEntries = useCallback(
    (id: NoteId): MenuEntry[] => {
      if (state.status !== "open") return [];
      const { vault: open, media } = state;
      const note = open.note(id);
      if (note === undefined) return [];
      const failed = (error: unknown) => {
        setNotice({ text: error instanceof Error ? error.message : String(error) });
      };
      const { open: openFile, reveal } = media;
      return [
        {
          label: t("menuOpen"),
          icon: itemIcons.open,
          run: () => {
            openNote(id);
          },
        },
        {
          label: t("menuOpenNewTab"),
          icon: itemIcons.openNewTab,
          run: () => {
            openNote(id, undefined, "tab");
          },
        },
        {
          label: t("menuOpenRight"),
          icon: itemIcons.openRight,
          run: () => {
            openNote(id, undefined, "right");
          },
        },
        "separator",
        {
          label: t("menuRename"),
          icon: itemIcons.rename,
          run: () => {
            setNoteDialog({ kind: "rename", id });
          },
        },
        {
          label: t("menuCopy"),
          icon: itemIcons.copy,
          run: () => {
            setNotice(undefined);
            copyNote(open, id).then((copy) => {
              setNotice({ text: t("copiedNote", { name: note.title, copy: copy.title }) });
              openNote(copy.id);
            }, failed);
          },
        },
        {
          label: t("menuMove"),
          icon: itemIcons.move,
          run: () => {
            setNoteDialog({ kind: "move", id });
          },
        },
        {
          label: t("menuMerge"),
          icon: itemIcons.merge,
          run: () => {
            setNoteDialog({ kind: "merge", id });
          },
        },
        {
          label: t("menuTags"),
          icon: itemIcons.tags,
          run: () => {
            setNoteDialog({ kind: "tags", id });
          },
        },
        {
          label: bookmarks.has(note.path) ? t("menuUnbookmark") : t("menuBookmark"),
          icon: itemIcons.bookmark,
          run: () => {
            toggleBookmark(note.path);
          },
        },
        "separator",
        {
          label: t("menuCopyLink"),
          icon: itemIcons.copyLink,
          run: () => {
            // The shortest link that finds it, as Obsidian writes one.
            const link = open.linkTo(note.path, "").replace(/\.md$/i, "");
            copyText(`[[${link}]]`, t("copiedLink", { name: note.title }));
          },
        },
        {
          label: t("menuCopyPath"),
          icon: itemIcons.copyPath,
          run: () => {
            copyText(note.path, t("copiedPath", { name: note.title }));
          },
        },
        {
          label: t("menuCopyFullPath"),
          icon: itemIcons.copyPath,
          run: () => {
            copyText(fullPath(info.path, note.path), t("copiedPath", { name: note.title }));
          },
        },
        ...(openFile === undefined && reveal === undefined ? [] : ["separator" as const]),
        ...(openFile === undefined
          ? []
          : [
              {
                label: t("menuOpenDefault"),
                icon: itemIcons.openDefault,
                run: () => {
                  openFile(note.path).catch(failed);
                },
              },
            ]),
        ...(reveal === undefined
          ? []
          : [
              {
                label: t("menuReveal"),
                icon: itemIcons.reveal,
                run: () => {
                  reveal(note.path).catch(failed);
                },
              },
            ]),
        "separator",
        {
          label: t("menuExport"),
          icon: itemIcons.export,
          run: () => {
            openNote(id);
            setDialog("export");
          },
        },
        {
          label: t("menuHistory"),
          icon: itemIcons.history,
          run: () => {
            openNote(id);
            setDialog("history");
          },
        },
        "separator",
        {
          label: t("moveToTrash"),
          icon: itemIcons.trash,
          danger: true,
          run: () => {
            trashNote(id);
          },
        },
      ];
    },
    [state, info.path, openNote, trashNote, copyText, bookmarks, toggleBookmark],
  );

  /** What each command does, and whether it can now: those about a note need one open. */
  const run = useMemo((): Readonly<Record<CommandId, (() => void) | undefined>> => {
    const open = state.status === "open";
    const note = open && selected !== undefined ? selected : undefined;
    const show = (name: "notes" | "tags" | "search" | "trash") => () => {
      setTag(undefined);
      setPanel(name);
    };
    return {
      palette: () => {
        setDialog("palette");
      },
      switcher: open
        ? () => {
            setSwitcher(true);
          }
        : undefined,
      search: open
        ? () => {
            setPanel("search");
            // Once the panel shows.
            requestAnimationFrame(() => searchInput.current?.focus());
          }
        : undefined,
      newNote: open
        ? () => {
            setNewIn("");
            setDialog("newNote");
          }
        : undefined,
      newFolder: open
        ? () => {
            setNewFolderIn("");
          }
        : undefined,
      newDatabase: open
        ? () => {
            const vault = state.vault;
            const folder =
              selectedPath?.includes("/") === true
                ? selectedPath.slice(0, selectedPath.lastIndexOf("/"))
                : "";
            void loadDatabases()
              .then(({ createDatabase }) => createDatabase(vault, folder, t("newDatabaseName")))
              .then((created) => {
                setTag(undefined);
                setPanel("notes");
                openNote(created.id);
              });
          }
        : undefined,
      dayNote: open
        ? () => {
            openPeriodic("day");
          }
        : undefined,
      weekNote: open
        ? () => {
            openPeriodic("week");
          }
        : undefined,
      monthNote: open
        ? () => {
            openPeriodic("month");
          }
        : undefined,
      toggleSource:
        note === undefined
          ? undefined
          : () => {
              ask(focusedKey, (current) => ({ ...current, source: current.source + 1 }));
            },
      rename:
        note === undefined
          ? undefined
          : () => {
              ask(focusedKey, (current) => ({ ...current, rename: current.rename + 1 }));
            },
      bookmark:
        note === undefined || !open
          ? undefined
          : () => {
              const path = state.vault.note(note)?.path;
              if (path !== undefined) toggleBookmark(path);
            },
      history:
        note === undefined
          ? undefined
          : () => {
              setDialog("history");
            },
      // Comments name their writer: a vault linked to a workspace has one (ADR 0044).
      comment:
        note === undefined ||
        mode !== "blocks" ||
        sync.me === undefined ||
        sync.levelOf?.(note) === "view"
          ? undefined
          : () => {
              ask(focusedKey, (current) => ({ ...current, comment: current.comment + 1 }));
            },
      export:
        note === undefined
          ? undefined
          : () => {
              setDialog("export");
            },
      splitRight:
        note === undefined
          ? undefined
          : () => {
              openNote(note, undefined, "right");
            },
      nextTab:
        (layout.panes[layout.focused]?.tabs.length ?? 0) < 2
          ? undefined
          : () => {
              changeLayout((current) => cycleTab(current, 1));
            },
      previousTab:
        (layout.panes[layout.focused]?.tabs.length ?? 0) < 2
          ? undefined
          : () => {
              changeLayout((current) => cycleTab(current, -1));
            },
      closeTab:
        note === undefined
          ? undefined
          : () => {
              changeLayout((current) =>
                closeTab(current, current.focused, current.panes[current.focused]?.active ?? 0),
              );
            },
      import: open
        ? () => {
            setDialog("import");
          }
        : undefined,
      trashNote:
        note === undefined
          ? undefined
          : () => {
              trashNote(note);
            },
      showNotes: open ? show("notes") : undefined,
      showTags: open ? show("tags") : undefined,
      showTrash: open ? show("trash") : undefined,
      openGraph: open
        ? () => {
            setGraphShown(true);
          }
        : undefined,
      templateSettings: open
        ? () => {
            setDialog("settings");
          }
        : undefined,
      appearance: open
        ? () => {
            setDialog("appearance");
          }
        : undefined,
      servers: () => {
        setDialog("servers");
      },
      sync: open
        ? () => {
            setDialog("sync");
          }
        : undefined,
      members:
        open && sync.link !== undefined
          ? () => {
              setDialog("members");
            }
          : undefined,
      // An encrypted workspace has General alone (ADR 0042).
      spaces:
        open && sync.link !== undefined && sync.link.encrypted !== true
          ? () => {
              setDialog("spaces");
            }
          : undefined,
      share:
        note !== undefined && sync.link !== undefined && sync.link.encrypted !== true
          ? () => {
              setDialog("share");
            }
          : undefined,
      notifications:
        open && sync.link !== undefined
          ? () => {
              setDialog("notifications");
            }
          : undefined,
      shortcuts: open
        ? () => {
            setDialog("shortcuts");
          }
        : undefined,
      checkUpdates: updates.available
        ? () => {
            void backend.checkForUpdates();
          }
        : undefined,
      updateChecks: updates.available
        ? () => {
            backend.setAutomaticUpdates(!updates.automatic).then(readUpdates, () => undefined);
          }
        : undefined,
      closeVault: onClose,
    };
  }, [
    state.status,
    selected,
    openPeriodic,
    trashNote,
    onClose,
    updates,
    readUpdates,
    sync.link,
    sync.me,
    sync.levelOf,
    mode,
    toggleBookmark,
    ask,
    focusedKey,
    layout,
    changeLayout,
    openNote,
  ]);

  // Shortcuts run their commands, before the editors, which have their own uses for keys.
  const latest = useRef({ run, hotkeys });
  latest.current = { run, hotkeys };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (listening.current) return;
      const keys = eventKeys(event);
      if (keys === undefined) return;
      const id = commandFor(latest.current.hotkeys, keys) as CommandId | undefined;
      const command = id === undefined ? undefined : latest.current.run[id];
      if (command === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      command();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const keysOf = (id: CommandId) => hotkeys[id]?.[0];
  const ariaOf = (id: CommandId) => {
    const keys = keysOf(id);
    return keys === undefined ? undefined : ariaKeys(keys);
  };

  // The tabs open when the vault was last open come back, with the note the
  // app was started with shown in the focused pane; with no tabs remembered,
  // the note open last, found by its path.
  useEffect(() => {
    if (vault === undefined) return;
    let restored = false;
    try {
      const stored = localStorage.getItem(tabsKey);
      let next =
        stored === null
          ? emptyLayout
          : readLayout(JSON.parse(stored) as unknown, (id) => vault.note(id) !== undefined);
      const path =
        startNote ?? (activeNote(next) === undefined ? localStorage.getItem(lastNoteKey) : null);
      const note = path === null ? undefined : vault.noteAt(path);
      if (note !== undefined) next = openHere(next, note.id);
      if (activeNote(next) !== undefined) {
        changeLayout((current) => (activeNote(current) === undefined ? next : current));
        restored = true;
      }
    } catch {
      // Storage closed to the page, or what it kept unreadable: the vault opens to no note.
    }
    if (!restored) loadLinks();
  }, [vault, startNote, lastNoteKey, tabsKey, loadLinks, changeLayout]);
  useEffect(() => {
    if (vault === undefined) return;
    try {
      localStorage.setItem(tabsKey, JSON.stringify(layout));
    } catch {
      // Not remembered: the vault opens to its last note next time.
    }
  }, [vault, layout, tabsKey]);
  const selectedPath = selected === undefined ? undefined : vault?.note(selected)?.path;
  useEffect(() => {
    if (selectedPath === undefined) return;
    try {
      localStorage.setItem(lastNoteKey, selectedPath);
    } catch {
      // Not remembered: the vault opens to no note next time.
    }
  }, [selectedPath, lastNoteKey]);

  const shown = useMemo(() => {
    if (tag === undefined || graph === undefined) return notes;
    const tagged = new Set(graph.notesWithTag(tag));
    return notes.filter((note) => tagged.has(note.id));
  }, [notes, tag, graph, version]);

  /** A command's name, as it reads now: a bookmarked note's is to remove it. */
  const commandName = (id: CommandId): string =>
    id === "updateChecks" && !updates.automatic
      ? t("command_updateChecksOn")
      : id === "bookmark" && selectedPath !== undefined && bookmarks.has(selectedPath)
        ? t("command_bookmarkRemove")
        : t(`command_${id}`);

  /** The menus' items, each a command; one that cannot run now shows, but cannot be chosen. */
  const menuOf = (
    label: string,
    icon: Menu["icon"],
    ids: readonly (CommandId | "separator")[],
  ): Menu => ({
    label,
    icon,
    entries: ids.map((id) => {
      if (id === "separator") return id;
      const command = run[id];
      const keys = keysOf(id);
      return {
        label: commandName(id),
        run: () => {
          command?.();
        },
        disabled: command === undefined,
        danger: id === "trashNote",
        icon: commandIcons[id],
        ...(keys === undefined ? {} : { keys }),
      };
    }),
  });
  const menus: readonly Menu[] = [
    menuOf(t("menuFile"), menuIcons.file, [
      "newNote",
      "newFolder",
      "newDatabase",
      "dayNote",
      "weekNote",
      "monthNote",
      "separator",
      "import",
      "export",
      "separator",
      "closeVault",
    ]),
    menuOf(t("menuNote"), menuIcons.note, [
      "rename",
      "bookmark",
      "toggleSource",
      "history",
      "comment",
      "splitRight",
      "separator",
      "trashNote",
    ]),
    menuOf(t("menuView"), menuIcons.view, [
      "palette",
      "switcher",
      "search",
      "openGraph",
      "separator",
      "showNotes",
      "showTags",
      "showTrash",
      "separator",
      "nextTab",
      "previousTab",
      "closeTab",
    ]),
    menuOf(t("menuSync"), menuIcons.sync, [
      "servers",
      "sync",
      "members",
      "spaces",
      "share",
      "notifications",
    ]),
    menuOf(t("menuSettings"), menuIcons.settings, [
      "templateSettings",
      "appearance",
      "shortcuts",
      "separator",
      "checkUpdates",
      "updateChecks",
    ]),
  ];

  return (
    <div
      className="vault"
      style={{ "--sidebar-width": `${String(sidebarWidth)}px` } as CSSProperties}
    >
      <aside id="sidebar" className="sidebar" aria-label={info.name}>
        <SidebarResizer width={sidebarWidth} onResize={setSidebarWidth} controls="sidebar" />
        <header className="sidebar-header">
          <h2 title={info.path}>{info.name}</h2>
          <div className="sidebar-header-actions">
            <button type="button" className="quiet" onClick={onClose}>
              {t("closeVault")}
            </button>
          </div>
        </header>
        {state.status === "open" ? <MenuBar label={t("menus")} menus={menus} /> : null}
        {state.status === "opening" ? (
          <p className="placeholder" role="status">
            {t("indexing")}
          </p>
        ) : state.status === "failed" ? (
          <p role="alert">{state.error.message}</p>
        ) : (
          <>
            <div className="sidebar-actions">
              <IconButton
                icon={commandIcons.newNote}
                label={t("newNote")}
                keys={keysOf("newNote")}
                ariaKeys={ariaOf("newNote")}
                hasPopup="dialog"
                onClick={() => {
                  setNewIn("");
                  setDialog("newNote");
                }}
              />
              <IconButton
                icon={commandIcons.newFolder}
                label={t("newFolder")}
                keys={keysOf("newFolder")}
                ariaKeys={ariaOf("newFolder")}
                hasPopup="dialog"
                onClick={() => {
                  setNewFolderIn("");
                }}
              />
              <IconButton
                icon={commandIcons.newDatabase}
                label={t("newDatabase")}
                keys={keysOf("newDatabase")}
                ariaKeys={ariaOf("newDatabase")}
                disabled={run.newDatabase === undefined}
                onClick={() => {
                  run.newDatabase?.();
                }}
              />
              {periods
                .filter((period) => settings[period].enabled)
                .map((period) => (
                  <IconButton
                    key={period}
                    icon={commandIcons[`${period}Note`]}
                    label={t(`${period}Note`)}
                    keys={keysOf(`${period}Note`)}
                    ariaKeys={ariaOf(`${period}Note`)}
                    onClick={() => {
                      openPeriodic(period);
                    }}
                  />
                ))}
            </div>
            {notice === undefined ? null : (
              <p className="notice sidebar-notice" role="status">
                <span className="sidebar-notice-text">
                  {notice.text}
                  {notice.restore === undefined ? null : (
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        const where = notice.restore;
                        if (where === undefined) return;
                        state.vault.restore(where).then(openRestored, (error: unknown) => {
                          setNotice({
                            text: error instanceof Error ? error.message : String(error),
                          });
                        });
                      }}
                    >
                      {t("restore")}
                    </button>
                  )}
                </span>
                <button
                  type="button"
                  className="quiet notice-dismiss"
                  aria-label={t("dismiss")}
                  title={t("dismiss")}
                  onClick={() => {
                    setNotice(undefined);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </p>
            )}
            <div className="sidebar-tabs">
              <button
                type="button"
                aria-pressed={panel === "notes"}
                onClick={() => {
                  setPanel("notes");
                }}
              >
                {t("notes")}
              </button>
              <button
                type="button"
                aria-pressed={panel === "tags"}
                onClick={() => {
                  setPanel("tags");
                }}
              >
                {t("tags")}
              </button>
              <button
                type="button"
                aria-pressed={panel === "search"}
                aria-keyshortcuts={ariaOf("search")}
                onClick={() => {
                  setPanel("search");
                }}
              >
                {t("search")}
              </button>
              <button
                type="button"
                aria-pressed={panel === "trash"}
                onClick={() => {
                  setPanel("trash");
                }}
              >
                {t("trash")}
              </button>
            </div>
            {panel === "trash" ? (
              <TrashPanel vault={state.vault} onRestored={openRestored} />
            ) : panel === "search" ? (
              <SearchPanel
                vault={state.vault}
                graph={state.indexer.graph}
                onOpen={openNote}
                input={searchInput}
              />
            ) : panel === "tags" ? (
              <TagList graph={state.indexer.graph} onSelect={showTag} />
            ) : notes.length === 0 ? (
              <p className="placeholder">{t("noNotes")}</p>
            ) : (
              <>
                {tag === undefined ? null : (
                  <p className="filter">
                    {t("taggedWith", { tag })}
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        setTag(undefined);
                      }}
                    >
                      {t("allNotes")}
                    </button>
                  </p>
                )}
                {tag === undefined && bookmarks.list.length > 0 ? (
                  <BookmarkList
                    vault={state.vault}
                    bookmarks={bookmarks.list}
                    selected={selected}
                    onOpen={openNote}
                    onRemove={toggleBookmark}
                    onMenu={openMenu}
                    menuFor={menu?.id}
                    storageKey={`nether.bookmarks.${info.id}`}
                  />
                ) : null}
                {tag === undefined ? (
                  <div className="view-switch" role="group" aria-label={t("notesView")}>
                    {notesViews.map((view) => (
                      <button
                        key={view}
                        type="button"
                        aria-pressed={notesView === view}
                        onClick={() => {
                          setNotesView(view);
                          storeView(view);
                        }}
                      >
                        {t(`view_${view}`)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {tag !== undefined || notesView === "list" ? (
                  <NoteList
                    notes={shown}
                    selected={selected}
                    onSelect={openNote}
                    onMenu={openMenu}
                    onOpenInNewTab={openInTab}
                    menuFor={menu?.id}
                    label={t("notes")}
                  />
                ) : (
                  <NoteTree
                    notes={notes}
                    mode={notesView}
                    selected={selected}
                    onSelect={openNote}
                    onMove={moveInTree}
                    onNewIn={newNoteIn}
                    onMenu={openMenu}
                    folders={folders}
                    onFolderMenu={openFolderMenu}
                    folderMenuFor={folderMenu?.path}
                    onOpenInNewTab={openInTab}
                    menuFor={menu?.id}
                    label={t("notes")}
                    storageKey={`nether.tree.${info.id}.${notesView}`}
                  />
                )}
                <p className="count" role="status">
                  {notes.length === 1
                    ? t("oneNote")
                    : t("noteCount", { count: numbers.format(notes.length) })}
                </p>
              </>
            )}
            <IndexStatus indexer={state.indexer} />
            {sync.link === undefined ? null : (
              <p className="notify-line">
                <button
                  type="button"
                  className="quiet"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setDialog("notifications");
                  }}
                >
                  {notifications.unread === 0
                    ? t("notifications")
                    : t("notificationsUnread", { count: notifications.unread })}
                </button>
              </p>
            )}
            {sync.link === undefined ? null : (
              <p className="sync-line" aria-live="polite">
                <button
                  type="button"
                  className="quiet"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setDialog("sync");
                  }}
                >
                  {syncSummary(sync.link, sync.status, sync.signedOut, sync.problem)}
                </button>
              </p>
            )}
          </>
        )}
      </aside>
      {switcher && state.status === "open" ? (
        <QuickSwitcher
          vault={state.vault}
          graph={state.indexer.graph}
          onOpen={openNote}
          onClose={() => {
            setSwitcher(false);
          }}
        />
      ) : null}
      {dialog === "newNote" && state.status === "open" ? (
        <NewNoteDialog
          notes={notes}
          folder={newIn}
          settings={settings}
          onCreate={(path, template) => makeNote(path, template, new Date())}
          onClose={() => {
            setDialog(undefined);
          }}
        />
      ) : null}
      {dialog === "import" && state.status === "open" ? (
        <Suspense fallback={null}>
          <ImportDialog
            vault={state.vault}
            importer={state.importer}
            onOpen={(path) => {
              const note = state.vault.noteAt(path);
              setDialog(undefined);
              if (note !== undefined) openNote(note.id);
            }}
            onClose={() => {
              setDialog(undefined);
            }}
          />
        </Suspense>
      ) : null}
      {dialog === "appearance" && state.status === "open" ? (
        <Suspense fallback={null}>
          <AppearanceDialog
            vault={state.vault}
            state={appearance}
            onClose={() => {
              setDialog(undefined);
            }}
          />
        </Suspense>
      ) : null}
      {dialog === "sync" && state.status === "open" ? (
        <Suspense fallback={null}>
          <SyncDialog
            vault={state.vault}
            sync={sync}
            onServers={() => {
              setDialog("servers");
            }}
            onClose={() => {
              setDialog(undefined);
            }}
          />
        </Suspense>
      ) : null}
      {dialog === "spaces" && sync.link !== undefined && state.status === "open" ? (
        <Suspense fallback={null}>
          <SpacesDialog
            link={sync.link}
            folders={[
              ...new Set(
                state.vault
                  .notes()
                  .flatMap((entry) =>
                    entry.path.includes("/") ? [entry.path.slice(0, entry.path.indexOf("/"))] : [],
                  ),
              ),
            ].sort()}
            onClose={() => {
              setDialog(undefined);
            }}
          />
        </Suspense>
      ) : null}
      {dialog === "share" &&
      sync.link !== undefined &&
      state.status === "open" &&
      selected !== undefined
        ? (() => {
            const note = state.vault.note(selected);
            return note === undefined ? null : (
              <Suspense fallback={null}>
                <ShareDialog
                  link={sync.link}
                  note={note}
                  onClose={() => {
                    setDialog(undefined);
                  }}
                />
              </Suspense>
            );
          })()
        : null}
      {dialog === "notifications" && sync.link !== undefined && state.status === "open" ? (
        <Suspense fallback={null}>
          <NotificationsDialog
            link={sync.link}
            notifications={notifications}
            hasNote={(id) => state.vault.note(id as NoteId) !== undefined}
            onOpen={(id, thread) => {
              setDialog(undefined);
              const key = openNote(id as NoteId);
              if (thread !== undefined) {
                ask(key, (current) => ({
                  ...current,
                  thread: { thread, key: (current.thread?.key ?? 0) + 1 },
                }));
              }
            }}
            onClose={() => {
              setDialog(undefined);
            }}
          />
        </Suspense>
      ) : null}
      {dialog === "members" && sync.link !== undefined ? (
        <Suspense fallback={null}>
          <MembersDialog
            link={sync.link}
            onLeft={() => {
              setDialog(undefined);
              void sync.unlink();
            }}
            onClose={() => {
              setDialog(undefined);
            }}
          />
        </Suspense>
      ) : null}
      {dialog === "servers" ? (
        <Suspense fallback={null}>
          <ServersDialog
            onClose={() => {
              setDialog(undefined);
            }}
          />
        </Suspense>
      ) : null}
      {dialog === "settings" && state.status === "open" ? (
        <TemplateSettingsDialog
          settings={settings}
          templates={templateChoices(notes, settings.folder, "").map((note) =>
            note.path.replace(/\.md$/i, ""),
          )}
          onSave={save}
          onClose={() => {
            setDialog(undefined);
          }}
        />
      ) : null}
      {folderMenu === undefined || state.status !== "open" ? null : (
        <ContextMenu
          label={t("folderMenu", { name: folderMenu.path })}
          at={folderMenu.at}
          entries={folderEntries(folderMenu.path)}
          onClose={closeFolderMenu}
        />
      )}
      {newFolderIn === undefined || state.status !== "open" ? null : (
        <NewFolderDialog
          folder={newFolderIn}
          taken={pathTaken}
          onCreate={(path) => state.vault.makeFolder(path)}
          onClose={() => {
            setNewFolderIn(undefined);
          }}
        />
      )}
      {menu === undefined || state.status !== "open" ? null : (
        <ContextMenu
          label={t("noteMenu", { name: state.vault.note(menu.id)?.title ?? "" })}
          at={menu.at}
          entries={menuEntries(menu.id)}
          onClose={closeMenu}
        />
      )}
      {noteDialog === undefined || state.status !== "open"
        ? null
        : (() => {
            const note = state.vault.note(noteDialog.id);
            if (note === undefined) return null;
            const close = () => {
              setNoteDialog(undefined);
            };
            switch (noteDialog.kind) {
              case "rename":
                return (
                  <RenameNoteDialog
                    note={note}
                    onRename={(name) => renameCurrent(note.id, name)}
                    onClose={close}
                  />
                );
              case "move":
                return (
                  <MoveNoteDialog
                    note={note}
                    folders={vaultFolders(state.vault.files())}
                    onMove={(folder) => {
                      moveInTree({ kind: "note", path: note.path }, folder);
                      return Promise.resolve();
                    }}
                    onClose={close}
                  />
                );
              case "merge":
                return (
                  <MergeNoteDialog
                    note={note}
                    notes={notes}
                    onMerge={(into) => mergeInto(note.id, into)}
                    onClose={close}
                  />
                );
              case "tags":
                return (
                  <NoteTagsDialog
                    vault={state.vault}
                    note={note}
                    known={state.indexer.graph.tags().map((entry) => entry.tag)}
                    onClose={close}
                  />
                );
            }
          })()}
      {dialog === "export" && state.status === "open" && selected !== undefined
        ? (() => {
            const note = state.vault.note(selected);
            return note === undefined ? null : (
              <ExportDialog
                vault={state.vault}
                vaultName={info.name}
                graph={state.indexer.graph}
                media={state.media}
                exporter={state.exporter}
                note={note}
                notes={notes}
                onClose={() => {
                  setDialog(undefined);
                }}
              />
            );
          })()
        : null}
      {dialog === "history" && state.status === "open" && selected !== undefined
        ? (() => {
            const note = state.vault.note(selected);
            return note === undefined ? null : (
              <Suspense fallback={null}>
                <HistoryDialog
                  vault={state.vault}
                  note={note}
                  link={sync.link}
                  onClose={() => {
                    setDialog(undefined);
                  }}
                />
              </Suspense>
            );
          })()
        : null}
      {dialog === "palette" ? (
        <CommandPalette
          commands={commandIds.flatMap((id) =>
            run[id] === undefined
              ? []
              : [
                  {
                    id,
                    name: commandName(id),
                    keys: hotkeys[id] ?? [],
                  },
                ],
          )}
          onRun={(id) => {
            run[id as CommandId]?.();
          }}
          onClose={() => {
            setDialog(undefined);
          }}
        />
      ) : null}
      {dialog === "shortcuts" ? (
        <ShortcutsDialog
          commands={commandIds.map((id) => ({ id, name: t(`command_${id}`) }))}
          defaults={defaultHotkeys}
          chosen={chosenHotkeys}
          onListening={setListening}
          onSave={saveHotkeys}
          onClose={() => {
            setDialog(undefined);
          }}
        />
      ) : null}
      <main className="pane">
        {state.status === "open" && graphShown ? (
          <Suspense fallback={<p className="placeholder">{t("loadingGraph")}</p>}>
            <GraphView
              vault={state.vault}
              graph={state.indexer.graph}
              note={selected}
              onOpenNote={openNote}
              onClose={() => {
                setGraphShown(false);
              }}
            />
          </Suspense>
        ) : state.status === "open" && layout.panes.some((pane) => pane.tabs.length > 0) ? (
          noteView === undefined ? null : (
            <div className={`panes${layout.panes.length > 1 ? " split" : ""}`}>
              {layout.panes.map((pane, index) => {
                const id = shownIn(pane);
                const paneAsks = asks[pane.key] ?? noAsks;
                const split = layout.panes.length > 1;
                const side = index === 0 ? "Left" : "Right";
                const panelId = `pane-${String(pane.key)}`;
                const tabId = (tab: number) => `pane-${String(pane.key)}-tab-${String(tab)}`;
                const focusHere = () => {
                  changeLayout((current) => focusPane(current, index));
                };
                return (
                  <section
                    key={pane.key}
                    className={`note-pane${split && index === layout.focused ? " focused" : ""}`}
                    aria-label={split ? t(`pane${side}`) : undefined}
                    onFocusCapture={focusHere}
                    onMouseDownCapture={focusHere}
                  >
                    <TabStrip
                      pane={pane}
                      label={split ? t(`openNotes${side}`) : t("openNotes")}
                      panelId={panelId}
                      tabId={tabId}
                      titleOf={(note) => state.vault.note(note)?.title ?? ""}
                      onChoose={(tab) => {
                        changeLayout((current) => chooseTab(current, index, tab));
                      }}
                      onClose={(tab) => {
                        changeLayout((current) => closeTab(current, index, tab));
                      }}
                      onMenu={openMenu}
                    />
                    <div
                      className="pane-body"
                      role="tabpanel"
                      id={panelId}
                      aria-labelledby={tabId(pane.active)}
                    >
                      {id === undefined ? (
                        <p className="placeholder">{t("selectNote")}</p>
                      ) : (
                        <noteView.default
                          live={sync.live}
                          vault={state.vault}
                          media={state.media}
                          exporter={state.exporter}
                          graph={state.indexer.graph}
                          id={id}
                          titleId={index === 0 ? "note-title" : "note-title-right"}
                          focus={paneAsks.focus}
                          onOpenNote={openNote}
                          onOpenTag={showTag}
                          mode={paneAsks.mode}
                          onMode={(next) => {
                            ask(pane.key, (current) => ({ ...current, mode: next }));
                          }}
                          onTrash={() => {
                            trashNote(id);
                          }}
                          onExport={() => {
                            focusHere();
                            setDialog("export");
                          }}
                          onRename={(name) => renameCurrent(id, name)}
                          sourceRequest={paneAsks.source}
                          renameRequest={paneAsks.rename}
                          sourceKeys={keysOf("toggleSource")}
                          me={sync.me}
                          canComment={sync.levelOf?.(id) !== "view"}
                          commentRequest={paneAsks.comment}
                          commentKeys={keysOf("comment")}
                          people={people}
                          onMention={(thread, mentioned, body) => {
                            const link = sync.link;
                            const note = state.vault.note(id);
                            if (link === undefined || note === undefined) return;
                            // An encrypted workspace's server is told who, never what.
                            const text =
                              link.encrypted === true
                                ? {}
                                : { title: note.title.slice(0, 200), excerpt: body.slice(0, 500) };
                            void queueMention(state.vault.settings, {
                              server: link.server,
                              workspaceId: link.workspaceId,
                              note: id,
                              thread,
                              people: mentioned.map((person) => person.id),
                              ...text,
                            }).then(notifications.refresh);
                          }}
                          {...(paneAsks.thread === undefined
                            ? {}
                            : { threadRequest: paneAsks.thread })}
                          onShown={loadLinks}
                        />
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )
        ) : (
          <p className="placeholder">{t("selectNote")}</p>
        )}
      </main>
    </div>
  );
}
