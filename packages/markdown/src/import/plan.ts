// What an import reads and what it writes (ADR 0027): a source's files, by
// their paths in it, and their text; and a plan of the notes to make and
// the files to copy into the vault, each at its path there, with what could
// not be brought over as it was. The app carries the plan out; an importer
// only reads.

/** What is imported: a folder, a ZIP file's contents, or chosen files. */
export interface ImportSource {
  /** What was chosen, as the folder or file is named. */
  readonly name: string;
  /** Its files, by their paths in it, slashes between folders. */
  readonly files: readonly { readonly path: string; readonly size: number }[];
  /** A file's text. */
  readText(path: string): Promise<string>;
}

/** A note to make, at its path in the vault, with its Markdown. */
export interface PlannedNote {
  readonly path: string;
  readonly text: string;
}

/** A file to copy from the source into the vault, at its path there. */
export interface PlannedFile {
  readonly from: string;
  readonly to: string;
}

export interface ImportPlan {
  readonly notes: readonly PlannedNote[];
  readonly files: readonly PlannedFile[];
  /** What could not be brought over as it was, for the user to know. */
  readonly warnings: readonly string[];
}

/** Whether a path names a Markdown note. */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** A path as a note's: `.markdown` written `.md`. */
export function notePath(path: string): string {
  return path.replace(/\.markdown$/i, ".md");
}

/** A note's or folder's name as file systems take it: without what they forbid, and never empty. */
export function safeName(name: string, fallback = "Untitled"): string {
  const clean = name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    // Tabs and line breaks as spaces, then the other control characters gone.
    .replace(/\s+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  return clean === "" ? fallback : clean;
}

/** Joins a folder and a path in it, the vault's top being "". */
export function within(folder: string, path: string): string {
  return folder === "" ? path : `${folder}/${path}`;
}

/** Names that are not taken yet: the first `name`, then `name 2`, `name 3`, case aside. */
export function freeNames(): (name: string) => string {
  const taken = new Set<string>();
  return (name) => {
    for (let count = 1; ; count++) {
      const candidate = count === 1 ? name : `${name} ${String(count)}`;
      if (!taken.has(candidate.toLowerCase())) {
        taken.add(candidate.toLowerCase());
        return candidate;
      }
    }
  };
}
