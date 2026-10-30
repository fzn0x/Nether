// The app's commands: every action, by its ID, in the order the palette and
// the shortcuts list show them, and the shortcuts each has unless the
// vault chooses others. Their names are in the messages, as `command_ID`.
import type { Hotkeys } from "./shortcuts.ts";

export const commandIds = [
  "palette",
  "switcher",
  "search",
  "newNote",
  "dayNote",
  "weekNote",
  "monthNote",
  "toggleSource",
  "rename",
  "export",
  "trashNote",
  "showNotes",
  "showTags",
  "showTrash",
  "templateSettings",
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
  export: ["Mod+Shift+E"],
  templateSettings: ["Mod+,"],
};
