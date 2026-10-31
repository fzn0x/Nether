// The app's commands: every action, by its ID, in the order the palette and
// the shortcuts list show them, and the shortcuts each has unless the
// vault chooses others. Their names are in the messages, as `command_ID`.
import { type Hotkeys, isMac } from "./shortcuts.ts";

export const commandIds = [
  "palette",
  "switcher",
  "search",
  "newNote",
  "newFolder",
  "newDatabase",
  "dayNote",
  "weekNote",
  "monthNote",
  "toggleSource",
  "rename",
  "bookmark",
  "history",
  "comment",
  "export",
  "splitRight",
  "nextTab",
  "previousTab",
  "closeTab",
  "import",
  "trashNote",
  "showNotes",
  "showTags",
  "showTrash",
  "openGraph",
  "templateSettings",
  "appearance",
  "servers",
  "sync",
  "members",
  "spaces",
  "share",
  "notifications",
  "shortcuts",
  "checkUpdates",
  "updateChecks",
  "closeVault",
] as const;

export type CommandId = (typeof commandIds)[number];

/** The shortcuts commands have unless the vault chooses others; the rest have none. */
export const defaultHotkeys: Hotkeys = {
  palette: ["Mod+P"],
  switcher: ["Mod+O"],
  search: ["Mod+Shift+F"],
  newNote: ["Mod+N"],
  dayNote: ["Mod+Shift+D"],
  toggleSource: ["Mod+/"],
  rename: ["F2"],
  comment: ["Mod+Alt+M"],
  export: ["Mod+Shift+E"],
  // Ctrl and Tab, as browsers have it: on a Mac, Cmd and Tab is the system's.
  nextTab: [isMac() ? "Ctrl+Tab" : "Mod+Tab"],
  previousTab: [isMac() ? "Ctrl+Shift+Tab" : "Mod+Shift+Tab"],
  closeTab: ["Mod+W"],
  openGraph: ["Mod+G"],
  templateSettings: ["Mod+,"],
};
