// A vault's bookmarks: notes kept at hand above the others, in the order
// they were added. They are kept in `.nether/bookmarks.json`, in the shape
// Obsidian gives `.obsidian/bookmarks.json`, whose bookmarks a vault moved
// from Obsidian starts with: a note's bookmark by its path, which follows
// the note when it is renamed or moved.

export interface Bookmark {
  readonly path: string;
  /** When it was added, in milliseconds since 1970. */
  readonly added: number;
}

/** A vault's bookmarks from their file: the notes, those in Obsidian's groups too, each once. */
export function readBookmarks(data: unknown): Bookmark[] {
  const found: Bookmark[] = [];
  const seen = new Set<string>();
  const read = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items as unknown[]) {
      if (typeof item !== "object" || item === null) continue;
      const { type, path, ctime, items: inner } = item as Record<string, unknown>;
      if (type === "group") read(inner);
      if (type !== "file" || typeof path !== "string" || !/\.md$/i.test(path)) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      found.push({ path, added: typeof ctime === "number" ? ctime : 0 });
    }
  };
  if (typeof data === "object" && data !== null) read((data as { items?: unknown }).items);
  return found;
}

/** The bookmarks as their file keeps them. */
export function bookmarksData(bookmarks: readonly Bookmark[]): unknown {
  return { items: bookmarks.map(({ path, added }) => ({ type: "file", ctime: added, path })) };
}

/** The bookmarks with a note's added last, or taken out when it has one. */
export function toggleBookmark(
  bookmarks: readonly Bookmark[],
  path: string,
  now: number,
): Bookmark[] {
  return bookmarks.some((bookmark) => bookmark.path === path)
    ? bookmarks.filter((bookmark) => bookmark.path !== path)
    : [...bookmarks, { path, added: now }];
}

/** The bookmarks with each path that moved changed, in their places; the same list when none did. */
export function movedBookmarks(
  bookmarks: readonly Bookmark[],
  moved: ReadonlyMap<string, string>,
): readonly Bookmark[] {
  if (!bookmarks.some((bookmark) => moved.has(bookmark.path))) return bookmarks;
  return bookmarks.map((bookmark) => {
    const path = moved.get(bookmark.path);
    return path === undefined ? bookmark : { ...bookmark, path };
  });
}
