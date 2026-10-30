import { describe, expect, it } from "vitest";
import { pagePath, relativePath } from "../src/exportNotes.ts";

describe("relativePath", () => {
  it("leads from one file of the vault to another, escaping each part", () => {
    expect(relativePath("a.html", "b.html")).toBe("b.html");
    expect(relativePath("Projects/Plan.html", "attachments/My photo.png")).toBe(
      "../attachments/My%20photo.png",
    );
    expect(relativePath("a/b/c.html", "a/d/e.png")).toBe("../d/e.png");
    expect(relativePath("a/b.html", "a/b/c.html")).toBe("b/c.html");
    expect(relativePath("index.html", "Daily/2026#1.html")).toBe("Daily/2026%231.html");
  });
});

describe("pagePath", () => {
  it("gives a note's page the note's path, as HTML", () => {
    expect(pagePath("Projects/Plan.md")).toBe("Projects/Plan.html");
    expect(pagePath("Notes.MD")).toBe("Notes.html");
  });
});
