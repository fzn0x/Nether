// Every string the interface shows, so that each can be translated. English
// is the first language; {name} in a message is filled in from its values.
export const messages = {
  appName: "Nether",
  tagline:
    "Notes that stay plain Markdown files you own, with databases and collaboration on a server you control.",
  openFolder: "Open a folder",
  openFolderHint: "Choose a folder of Markdown notes, such as an Obsidian vault, or an empty one.",
  recentVaults: "Recent vaults",
  forgetVault: "Remove {name} from this list",
  closeVault: "Close vault",
  browserPreview: "Browser preview: the sample vault lives in memory.",
  version: "Version {version} for {platform}",
  notes: "Notes",
  noteCount: "{count} notes",
  oneNote: "1 note",
  indexing: "Reading the vault",
  selectNote: "Select a note to read it.",
  noNotes: "This vault has no notes yet.",
  binaryNote: "This file is not UTF-8 text, so Nether leaves it as it is.",
  missingNote: "This note is no longer in the vault.",
  errorTitle: "Something went wrong",
  dismiss: "Dismiss",
} as const;

export type MessageKey = keyof typeof messages;

/** A message, with its {placeholders} filled in. */
export function t(key: MessageKey, values: Readonly<Record<string, string | number>> = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}
