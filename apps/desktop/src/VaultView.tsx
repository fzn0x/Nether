// An open vault: its notes, or its tags, on the left, and the selected note
// in the editor on the right. A tag shows the notes with it. New notes are
// made blank or from a template, and today's, this week's and this month's
// notes open, made the first time from theirs.
import type { NoteId, Period } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import type { NoteEntry } from "@nether/storage";
import {
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
import { useNotes, useVault } from "./useVault.ts";

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
  const bookmarks = useBookmarks(vault);
  const [selected, setSelected] = useState<NoteId | undefined>();
  // Whether the graph shows in place of the note.
  const [graphShown, setGraphShown] = useState(false);
  const lastNoteKey = `nether.lastNote.${info.id}`;

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

  // Where a link to a heading or block asked to go, in the note it opened.
  const [focus, setFocus] = useState<(NotePart & { readonly key: number }) | undefined>();
  // Blocks or source, kept from note to note.
  const [mode, setMode] = useState<NoteMode>("blocks");
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
  // Asks the open note to switch modes, to take a new name, or to comment on its selection.
  const [sourceRequest, setSourceRequest] = useState(0);
  const [renameRequest, setRenameRequest] = useState(0);
  const [commentRequest, setCommentRequest] = useState(0);
  // A thread a notification opens, with its note.
  const [threadRequest, setThreadRequest] = useState<
    { readonly thread: string; readonly key: number } | undefined
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
  const [notesView, setNotesView] = useState<NotesView>(storedView);
  // What happened to a note: a template the vault no longer has, or the note moved to the trash.
  const [notice, setNotice] = useState<
    { readonly text: string; readonly restore?: string } | undefined
  >();
  const { settings, save } = useTemplateSettings(vault);
  const version = useGraph(graph);

  const noteView = useNoteViewModule();

  const openNote = useCallback((id: NoteId, part?: NotePart) => {
    setGraphShown(false);
    setSelected(id);
    setFocus(
      part !== undefined && (part.heading !== undefined || part.block !== undefined)
        ? { ...part, key: Date.now() }
        : undefined,
    );
  }, []);

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
          setSelected((current) => (current === id ? undefined : current));
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
      const { moveFiles, pageMoves, renamedPath } = await loadRenameNote();
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
        const { folderMoves, moveFiles, pageMoves } = await loadRenameNote();
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
      setSelected((current) => (current === id ? into.id : current));
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

  const openMenu = useCallback((id: NoteId, at: MenuPoint) => {
    setMenu({ id, at });
  }, []);
  const closeMenu = useCallback(() => {
    setMenu(undefined);
  }, []);

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
          run: () => {
            openNote(id);
          },
        },
        "separator",
        {
          label: t("menuRename"),
          run: () => {
            setNoteDialog({ kind: "rename", id });
          },
        },
        {
          label: t("menuCopy"),
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
          run: () => {
            setNoteDialog({ kind: "move", id });
          },
        },
        {
          label: t("menuMerge"),
          run: () => {
            setNoteDialog({ kind: "merge", id });
          },
        },
        {
          label: t("menuTags"),
          run: () => {
            setNoteDialog({ kind: "tags", id });
          },
        },
        {
          label: bookmarks.has(note.path) ? t("menuUnbookmark") : t("menuBookmark"),
          run: () => {
            toggleBookmark(note.path);
          },
        },
        "separator",
        {
          label: t("menuCopyLink"),
          run: () => {
            // The shortest link that finds it, as Obsidian writes one.
            const link = open.linkTo(note.path, "").replace(/\.md$/i, "");
            copyText(`[[${link}]]`, t("copiedLink", { name: note.title }));
          },
        },
        {
          label: t("menuCopyPath"),
          run: () => {
            copyText(note.path, t("copiedPath", { name: note.title }));
          },
        },
        {
          label: t("menuCopyFullPath"),
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
                run: () => {
                  reveal(note.path).catch(failed);
                },
              },
            ]),
        "separator",
        {
          label: t("menuExport"),
          run: () => {
            openNote(id);
            setDialog("export");
          },
        },
        {
          label: t("menuHistory"),
          run: () => {
            openNote(id);
            setDialog("history");
          },
        },
        "separator",
        {
          label: t("moveToTrash"),
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
              setSourceRequest((count) => count + 1);
            },
      rename:
        note === undefined
          ? undefined
          : () => {
              setRenameRequest((count) => count + 1);
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
              setCommentRequest((count) => count + 1);
            },
      export:
        note === undefined
          ? undefined
          : () => {
              setDialog("export");
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

  // The note the app was started with opens first, or else the note open
  // when the vault was last open, found by its path.
  useEffect(() => {
    if (vault === undefined) return;
    let restored = false;
    try {
      const path = startNote ?? localStorage.getItem(lastNoteKey);
      const note = path === null ? undefined : vault.noteAt(path);
      if (note !== undefined) {
        setSelected((current) => current ?? note.id);
        restored = true;
      }
    } catch {
      // Storage closed to the page: the vault opens to no note.
    }
    if (!restored) loadLinks();
  }, [vault, startNote, lastNoteKey, loadLinks]);
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

  return (
    <div className="vault">
      <aside className="sidebar" aria-label={info.name}>
        <header className="sidebar-header">
          <h2 title={info.path}>{info.name}</h2>
          <div className="sidebar-header-actions">
            {state.status === "open" ? (
              <button
                type="button"
                className="quiet"
                aria-haspopup="dialog"
                onClick={() => {
                  setDialog("settings");
                }}
              >
                {t("vaultSettings")}
              </button>
            ) : null}
            <button type="button" className="quiet" onClick={onClose}>
              {t("closeVault")}
            </button>
          </div>
        </header>
        {state.status === "opening" ? (
          <p className="placeholder" role="status">
            {t("indexing")}
          </p>
        ) : state.status === "failed" ? (
          <p role="alert">{state.error.message}</p>
        ) : (
          <>
            <div className="sidebar-actions">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-keyshortcuts={ariaOf("newNote")}
                title={t("newNoteHint")}
                onClick={() => {
                  setNewIn("");
                  setDialog("newNote");
                }}
              >
                {t("newNote")}
              </button>
              {periods
                .filter((period) => settings[period].enabled)
                .map((period) => (
                  <button
                    key={period}
                    type="button"
                    title={t(`${period}NoteHint`)}
                    onClick={() => {
                      openPeriodic(period);
                    }}
                  >
                    {t(`${period}Note`)}
                  </button>
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
              openNote(id as NoteId);
              if (thread !== undefined) {
                setThreadRequest((last) => ({ thread, key: (last?.key ?? 0) + 1 }));
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
                    name:
                      id === "updateChecks" && !updates.automatic
                        ? t("command_updateChecksOn")
                        : id === "bookmark" &&
                            selectedPath !== undefined &&
                            bookmarks.has(selectedPath)
                          ? t("command_bookmarkRemove")
                          : t(`command_${id}`),
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
        ) : state.status === "open" && selected !== undefined ? (
          noteView === undefined ? null : (
            <noteView.default
              live={sync.live}
              vault={state.vault}
              media={state.media}
              exporter={state.exporter}
              graph={state.indexer.graph}
              id={selected}
              focus={focus}
              onOpenNote={openNote}
              onOpenTag={showTag}
              mode={mode}
              onMode={setMode}
              onTrash={() => {
                trashNote(selected);
              }}
              onExport={() => {
                setDialog("export");
              }}
              onRename={(name) => renameCurrent(selected, name)}
              sourceRequest={sourceRequest}
              renameRequest={renameRequest}
              sourceKeys={keysOf("toggleSource")}
              me={sync.me}
              canComment={sync.levelOf?.(selected) !== "view"}
              commentRequest={commentRequest}
              commentKeys={keysOf("comment")}
              people={people}
              onMention={(thread, mentioned, body) => {
                const link = sync.link;
                const note = state.vault.note(selected);
                if (link === undefined || note === undefined) return;
                // An encrypted workspace's server is told who, never what.
                const text =
                  link.encrypted === true
                    ? {}
                    : { title: note.title.slice(0, 200), excerpt: body.slice(0, 500) };
                void queueMention(state.vault.settings, {
                  server: link.server,
                  workspaceId: link.workspaceId,
                  note: selected,
                  thread,
                  people: mentioned.map((person) => person.id),
                  ...text,
                }).then(notifications.refresh);
              }}
              {...(threadRequest === undefined ? {} : { threadRequest })}
              onShown={loadLinks}
            />
          )
        ) : (
          <p className="placeholder">{t("selectNote")}</p>
        )}
      </main>
    </div>
  );
}
