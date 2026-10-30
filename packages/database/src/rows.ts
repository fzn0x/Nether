// A database's rows: the notes in the folder beside its note with its name,
// and not those in folders below, which are the rows' own pages (ADR 0013).
import type { JsonValue, NoteId, PropertyEntry } from "@nether/core";

/** A note as a row: where it is, its file's times and its frontmatter. */
export interface Row {
  readonly id: NoteId;
  /** Relative to the vault, separated by slashes. */
  readonly path: string;
  /** Milliseconds since 1970, when the file's system knows them. */
  readonly created?: number;
  readonly updated: number;
  readonly properties: readonly PropertyEntry[];
}

/** The folder a database's rows are in: its note's path without `.md`. */
export function rowFolder(databasePath: string): string {
  return databasePath.replace(/\.md$/i, "");
}

/** Whether the note at `path` is a row of the database at `databasePath`. */
export function isRowOf(path: string, databasePath: string): boolean {
  const folder = `${rowFolder(databasePath)}/`;
  return (
    path.toLowerCase().startsWith(folder.toLowerCase()) &&
    !path.slice(folder.length).includes("/") &&
    /\.md$/i.test(path)
  );
}

/** The notes among `notes` that are rows of the database at `databasePath`, in their order. */
export function rowsOf<T extends { readonly path: string }>(
  notes: readonly T[],
  databasePath: string,
): T[] {
  return notes.filter((note) => isRowOf(note.path, databasePath));
}

/** A row's name, as its title shows: its file's name without `.md`. */
export function rowTitle(row: { readonly path: string }): string {
  return row.path.slice(row.path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/**
 * A row's value of a property: `$title`, `$created` and `$updated` from
 * its file, any other from its frontmatter; undefined when it has none.
 */
export function rowValue(row: Row, key: string): JsonValue | undefined {
  switch (key) {
    case "$title":
      return rowTitle(row);
    case "$created":
      return row.created;
    case "$updated":
      return row.updated;
    default:
      return row.properties.find((property) => property.key === key)?.value;
  }
}
