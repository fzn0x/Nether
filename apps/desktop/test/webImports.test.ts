// Imports in the web app (webImports.ts): what the browser's file picker
// gives, read as the desktop app's Go service reads it.
import { describe, expect, it } from "vitest";
import { filesImport, folderImport, zipImport } from "../src/webImports.ts";
import { makeZip } from "../src/webZip.ts";

const encoder = new TextEncoder();

/** A file as a folder picker gives it, with its path from the folder picked. */
function inFolder(path: string, text: string | Uint8Array): File {
  const file = new File(
    [typeof text === "string" ? text : text.slice()],
    path.split("/").at(-1) ?? "",
  );
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

async function zipFile(name: string, files: Record<string, string | Uint8Array>): Promise<File> {
  const blob = await makeZip(
    Object.entries(files).map(([path, data]) => ({
      path,
      data: typeof data === "string" ? encoder.encode(data) : data,
    })),
  );
  return new File([blob], name);
}

function attachTo(copied: Map<string, Uint8Array>) {
  return (dest: string, data: Uint8Array) => {
    copied.set(dest, data);
    return Promise.resolve(dest);
  };
}

describe("folderImport", () => {
  it("lists a folder's files by their paths in it, hidden ones left out", async () => {
    const copied = new Map<string, Uint8Array>();
    const source = folderImport(
      [
        inFolder("Vault/Welcome.md", "# Welcome"),
        inFolder("Vault/Projects/Plan.md", "# Plan"),
        inFolder("Vault/.obsidian/app.json", "{}"),
        inFolder("Vault/attachments/.DS_Store", ""),
        inFolder("Vault/attachments/cat.png", new Uint8Array([1, 2, 3])),
      ],
      attachTo(copied),
    );
    expect(source.name).toBe("Vault");
    expect(source.files).toEqual([
      { path: "Welcome.md", size: 9 },
      { path: "Projects/Plan.md", size: 6 },
      { path: "attachments/cat.png", size: 3 },
    ]);
    expect(await source.readText("Projects/Plan.md")).toBe("# Plan");
    expect(await source.copyInto("attachments/cat.png", "files/cat.png")).toBe("files/cat.png");
    expect([...(copied.get("files/cat.png") ?? [])]).toEqual([1, 2, 3]);
    await expect(source.readText(".obsidian/app.json")).rejects.toThrow("is not in the import");
  });

  it("refuses text that is not UTF-8", async () => {
    const source = folderImport(
      [inFolder("Vault/Latin.md", new Uint8Array([0x63, 0x61, 0x66, 0xe9]))],
      attachTo(new Map()),
    );
    await expect(source.readText("Latin.md")).rejects.toThrow("Latin.md is not UTF-8 text");
  });
});

describe("zipImport", () => {
  it("reads a ZIP's files, and those of the ZIP files in it, as Notion splits an export", async () => {
    const part = await makeZip([
      { path: "Export/Second page.md", data: encoder.encode("# Second") },
      { path: "Export/inner.zip", data: encoder.encode("not opened: only the outer ZIP's are") },
    ]);
    const zip = await zipFile("Notion export.zip", {
      "Export/First page.md": "# First",
      "Export/Part-2.zip": new Uint8Array(await part.arrayBuffer()),
      "Export/.hidden.md": "hidden",
      "../outside.md": "climbs out",
      "Export/./sub/../Third.md": "# Third",
    });
    const source = await zipImport(zip, attachTo(new Map()));
    expect(source.name).toBe("Notion export");
    expect(source.files.map((file) => file.path)).toEqual([
      "Export/First page.md",
      "Export/Second page.md",
      "Export/inner.zip",
      "Export/Third.md",
    ]);
    expect(await source.readText("Export/Second page.md")).toBe("# Second");
    expect(await source.readText("Export/Third.md")).toBe("# Third");
  });

  it("refuses what is not a ZIP file", async () => {
    await expect(
      zipImport(new File(["just text, not a zip file at all"], "notes.zip"), attachTo(new Map())),
    ).rejects.toThrow("This is not a ZIP file.");
  });
});

describe("filesImport", () => {
  it("lists the files chosen by their names, the first naming the import", async () => {
    const source = filesImport(
      [new File(["# One"], "One.md"), new File(["# Two"], "Two.markdown")],
      attachTo(new Map()),
    );
    expect(source.name).toBe("One");
    expect(source.files).toEqual([
      { path: "One.md", size: 5 },
      { path: "Two.markdown", size: 5 },
    ]);
    expect(await source.readText("Two.markdown")).toBe("# Two");
  });
});
