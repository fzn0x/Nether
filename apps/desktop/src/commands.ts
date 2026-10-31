// The app's commands: every action, by its ID, in the order the palette and
// the shortcuts list show them, and the shortcuts each has unless the
// vault chooses others. Their names are in the messages, as `command_ID`.
import type { Hotkeys } from "./shortcuts.ts";

export const commandIds = [
  "palette",
  "switcher",
  "search",
  "newNote",
  "newDatabase",
  "dayNote",
  "weekNote",
  "monthNote",
  "toggleSource",
  "rename",
  "history",
  "comment",
  "export",
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
  openGraph: ["Mod+G"],
  templateSettings: ["Mod+,"],
};
