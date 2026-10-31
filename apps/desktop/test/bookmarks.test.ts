// A vault's bookmarks: read from their file, Nether's or Obsidian's, written
// in Obsidian's shape, added and taken away, and following moved notes.
import { describe, expect, it } from "vitest";
import { bookmarksData, movedBookmarks, readBookmarks, toggleBookmark } from "../src/bookmarks.ts";

describe("readBookmarks", () => {
  it("reads Obsidian's notes, those in groups too, each once, and leaves out the rest", () => {
    const data = {
      items: [
        { type: "file", ctime: 1, path: "Welcome.md" },
        { type: "search", ctime: 2, query: "tag:#work" },
        { type: "file", ctime: 3, path: "photo.png" },
        {
          type: "group",
          ctime: 4,
          title: "Projects",
          items: [
            { type: "file", ctime: 5, path: "Projects/Plan.md" },
            { type: "file", ctime: 6, path: "Welcome.md" },
          ],
        },
        { type: "file", path: "No time.md" },
        "nonsense",
      ],
    };
    expect(readBookmarks(data)).toEqual([
      { path: "Welcome.md", added: 1 },
      { path: "Projects/Plan.md", added: 5 },
      { path: "No time.md", added: 0 },
    ]);
  });

  it("reads none from a missing or broken file", () => {
    expect(readBookmarks(undefined)).toEqual([]);
    expect(readBookmarks({ items: "x" })).toEqual([]);
  });

  it("writes in the shape it reads", () => {
    const bookmarks = [{ path: "Welcome.md", added: 7 }];
    expect(bookmarksData(bookmarks)).toEqual({
      items: [{ type: "file", ctime: 7, path: "Welcome.md" }],
    });
    expect(readBookmarks(bookmarksData(bookmarks))).toEqual(bookmarks);
  });
});

describe("changing bookmarks", () => {
  const bookmarks = [
    { path: "a.md", added: 1 },
    { path: "b.md", added: 2 },
  ];

  it("adds a note last, or takes its bookmark away", () => {
    expect(toggleBookmark(bookmarks, "c.md", 9)).toEqual([
      ...bookmarks,
      { path: "c.md", added: 9 },
    ]);
    expect(toggleBookmark(bookmarks, "a.md", 9)).toEqual([{ path: "b.md", added: 2 }]);
  });

  it("follows moved notes in their places, and keeps the same list when none moved", () => {
    expect(movedBookmarks(bookmarks, new Map([["a.md", "x/a.md"]]))).toEqual([
      { path: "x/a.md", added: 1 },
      { path: "b.md", added: 2 },
    ]);
    expect(movedBookmarks(bookmarks, new Map([["z.md", "y.md"]]))).toBe(bookmarks);
  });
});
