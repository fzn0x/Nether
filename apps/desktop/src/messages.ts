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
  tags: "Tags",
  properties: "Properties",
  propertyName: "Property name",
  propertyType: "Type of {name}",
  propertyValue: "{name}",
  removeValue: "Remove {value}",
  removeProperty: "Remove {name}",
  addProperty: "Add a property",
  unreadableFrontmatter:
    "Nether cannot read this note's frontmatter, so its properties stay as the file has them: {error}",
  type_text: "Text",
  type_number: "Number",
  type_checkbox: "Checkbox",
  type_date: "Date",
  type_url: "Link",
  type_select: "Select",
  type_multiSelect: "List",
  type_person: "Person",
  type_relation: "Notes",
  type_file: "File",
  search: "Search",
  searchLabel: "Search the vault",
  searchHint: 'Words, "a phrase", -word, tag:, path:, prop:',
  searchResults: "Notes found",
  noResults: "No notes match.",
  switcher: "Open a note",
  switcherLabel: "Note to open",
  switcherHint: "A note's name, alias or path",
  noTags: "No tags yet. Write #tag in a note, or give it a tags property.",
  taggedWith: "Notes tagged #{tag}",
  allNotes: "Show all notes",
  aboutNote: "About this note",
  outline: "Outline",
  noHeadings: "No headings.",
  backlinks: "Linked from",
  noBacklinks: "No other note links here.",
  noteCount: "{count} notes",
  oneNote: "1 note",
  indexing: "Reading the vault",
  indexingLinks: "Reading links: {done} of {total}",
  selectNote: "Select a note to read it.",
  noNotes: "This vault has no notes yet.",
  binaryNote: "This file is not UTF-8 text, so Nether leaves it as it is.",
  missingNote: "This note is no longer in the vault.",
  noteBody: "{title}, note text",
  emptyNote: "Write something, or type / for blocks",
  emptySource: "Write Markdown",
  noteSource: "{title}, Markdown source",
  sourceMode: "Markdown source",
  sourceModeHint: "Show the note as its Markdown, or as blocks again (Ctrl+/)",
  vimKeys: "Vim keys",
  saveFailed: "The note could not be saved: {error}",
  fileFailed: "The file could not be added or opened, or the note made: {error}",
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
