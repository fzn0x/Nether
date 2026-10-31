import { describe, expect, it } from "vitest";
import { type FileEvent, MemoryFiles, type VaultFiles, sha256 } from "../src/index.ts";
import { type OpfsDirectory, type OpfsFile, OpfsFiles } from "../src/index.ts";

// The origin private file system, in memory, failing as browsers do.
let clock = 1_000;

function domError(name: string, message: string): Error {
  return new DOMException(message, name);
}

class FakeFile implements OpfsFile {
  readonly kind = "file";
  data = new Uint8Array();
  modified = ++clock;
  /** Whether the next write fails before it is closed, as a full disk would make it. */
  failNext = false;

  getFile() {
    const data = this.data.slice();
    return Promise.resolve({
      size: data.length,
      lastModified: this.modified,
      arrayBuffer: () => Promise.resolve(data.buffer),
    });
  }

  createWritable() {
    const chunks: Uint8Array[] = [];
    return Promise.resolve({
      write: (data: Uint8Array) => {
        if (this.failNext) {
          this.failNext = false;
          return Promise.reject(domError("QuotaExceededError", "The disk is full."));
        }
        chunks.push(data.slice());
        return Promise.resolve();
      },
      close: () => {
        const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const data = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          data.set(chunk, at);
          at += chunk.length;
        }
        this.data = data;
        this.modified = ++clock;
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
    });
  }
}

class FakeDirectory implements OpfsDirectory {
  readonly kind = "directory";
  readonly children = new Map<string, FakeDirectory | FakeFile>();

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectory> {
    const found = this.children.get(name);
    if (found instanceof FakeDirectory) return Promise.resolve(found);
    if (found !== undefined)
      return Promise.reject(domError("TypeMismatchError", `${name} is a file.`));
    if (options?.create !== true)
      return Promise.reject(domError("NotFoundError", `${name} is not there.`));
    const made = new FakeDirectory();
    this.children.set(name, made);
    return Promise.resolve(made);
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFile> {
    const found = this.children.get(name);
    if (found instanceof FakeFile) return Promise.resolve(found);
    if (found !== undefined)
      return Promise.reject(domError("TypeMismatchError", `${name} is a folder.`));
    if (options?.create !== true)
      return Promise.reject(domError("NotFoundError", `${name} is not there.`));
    const made = new FakeFile();
    this.children.set(name, made);
    return Promise.resolve(made);
  }

  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const found = this.children.get(name);
    if (found === undefined)
      return Promise.reject(domError("NotFoundError", `${name} is not there.`));
    if (found instanceof FakeDirectory && found.children.size > 0 && options?.recursive !== true) {
      return Promise.reject(domError("InvalidModificationError", `${name} is not empty.`));
    }
    this.children.delete(name);
    return Promise.resolve();
  }

  async *entries(): AsyncGenerator<[string, OpfsDirectory | OpfsFile]> {
    // Browsers list a folder in no set order: backwards here, so nothing leans on one.
    for (const entry of [...this.children].reverse()) yield await Promise.resolve(entry);
  }
}

const bytes = (...values: number[]) => new Uint8Array(values);

/**
 * Runs the same steps on a vault and records what each gave, or the error
 * it threw, without modification times, which differ between stores.
 */
async function script(files: VaultFiles): Promise<unknown[]> {
  const out: unknown[] = [];
  const events: FileEvent[] = [];
  const stop = new AbortController();
  void files.watch((batch) => events.push(...batch), stop.signal);
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value.map(strip).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (value instanceof Uint8Array) return [...value];
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "modified")
        .map(([key, item]) => [key, strip(item)]),
    );
  };
  const step = async (name: string, work: () => Promise<unknown>) => {
    try {
      out.push([name, strip(await work())]);
    } catch (error) {
      out.push([name, (error as Error).name, (error as Error).message]);
    }
  };
  const listed = async (folder: string) => {
    const found: unknown[] = [];
    await files.list(folder, (batch) => found.push(...batch));
    return found;
  };

  await step("read a missing file", () => files.read("Nowhere.md"));
  const first = await files.write("Welcome.md", "# Welcome\n", "");
  out.push(["write", strip(first)]);
  await step("write over without a base", () => files.write("Welcome.md", "again", ""));
  await step("write over a changed file", () => files.write("Welcome.md", "again", "abc"));
  await step("write over", () => files.write("Welcome.md", "# Hello\n", first.hash));
  await step("write in folders", () => files.write("Projects/2026/Plan.md", "plan", ""));
  await step("hidden", () => files.write(".nether/settings.json", "{}", ""));
  await step("binary", () => files.writeBytes("attachments/raw.bin", bytes(0xff, 0xfe, 0x00), ""));
  await step("read binary", () => files.read("attachments/raw.bin"));
  await step("read bytes", () => files.readBytes("Welcome.md"));
  await step("bytes over a changed file", () =>
    files.writeBytes("attachments/raw.bin", bytes(1), ""),
  );
  await step("list", () => listed(""));
  await step("list a folder", () => listed("Projects"));
  await step("list a hidden folder", () => listed(".nether"));
  await step("stat", () => files.stat(["Welcome.md", "Nowhere.md", "Projects/2026/Plan.md"]));
  await step("attach", () => files.attach("attachments/cat.png", bytes(1, 2)));
  await step("attach again", () => files.attach("attachments/cat.png", bytes(3)));
  await step("attach without a dot", () => files.attach("attachments/README", bytes(4)));
  await step("attach it again", () => files.attach("attachments/README", bytes(5)));
  await step("rename", () => files.rename("Projects/2026/Plan.md", "Archive/Plan.md"));
  await step("rename onto a file", () => files.rename("Welcome.md", "Archive/Plan.md"));
  await step("rename a missing file", () => files.rename("Nowhere.md", "Here.md"));
  await step("remove", () => files.remove("Archive/Plan.md"));
  await files.write("Plan.md", "again", "");
  await step("remove the same name", () => files.remove("Plan.md"));
  await step("list the trash", () => listed(".trash"));
  await step("erase outside the trash", () => files.erase("Welcome.md"));
  await step("erase", () => files.erase(".trash/Plan.md"));
  await step("erase again", () => files.erase(".trash/Plan.md"));
  await step("folders", () => files.folders(""));
  await step("make a folder", () => files.makeFolder("Ideas/Garden"));
  await step("make it again", () => files.makeFolder("Ideas/Garden"));
  await step("make a hidden folder", () => files.makeFolder("Ideas/.secret"));
  await step("make a folder where a file is", () => files.makeFolder("Welcome.md"));
  await step("folders below", () => files.folders("Ideas"));
  await step("remove a full folder", () => files.removeFolder("attachments"));
  await step("remove an empty folder", () => files.removeFolder("Ideas/Garden"));
  await step("remove a missing folder", () => files.removeFolder("Ideas/Garden"));
  await step("a path out of the vault", () => files.read("../secret.md"));
  stop.abort();
  out.push(["events", events]);
  return out;
}

describe("OpfsFiles", () => {
  it("behaves as MemoryFiles does, step by step", async () => {
    const opfs = await script(new OpfsFiles(new FakeDirectory()));
    const memory = await script(new MemoryFiles());
    expect(opfs).toEqual(memory);
  });

  it("keeps files and folders in the origin's folders", async () => {
    const root = new FakeDirectory();
    const files = new OpfsFiles(root);
    await files.write("Projects/Plan.md", "plan", "");
    const projects = root.children.get("Projects");
    expect(projects).toBeInstanceOf(FakeDirectory);
    const plan = (projects as FakeDirectory).children.get("Plan.md") as FakeFile;
    expect(new TextDecoder().decode(plan.data)).toBe("plan");
    // A second store on the same folder, as after a reload, finds it.
    const again = await new OpfsFiles(root).read("Projects/Plan.md");
    expect(again).toMatchObject({ text: "plan", hash: await sha256("plan") });
  });

  it("gives modification times as the files have them", async () => {
    const files = new OpfsFiles(new FakeDirectory());
    const written = await files.write("A.md", "a", "");
    const [stat] = await files.stat(["A.md"]);
    expect(stat?.modified).toBe(written.modified);
    const later = await files.write("A.md", "b", written.hash);
    expect(later.modified).toBeGreaterThan(written.modified);
  });

  it("checks and writes one change at a time", async () => {
    const files = new OpfsFiles(new FakeDirectory());
    const results = await Promise.allSettled([
      files.write("Race.md", "one", ""),
      files.write("Race.md", "two", ""),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((await files.read("Race.md")).text).toBe("one");
  });

  it("leaves a file as it was when its write fails", async () => {
    const root = new FakeDirectory();
    const files = new OpfsFiles(root);
    const first = await files.write("A.md", "kept", "");
    (root.children.get("A.md") as FakeFile).failNext = true;
    await expect(files.write("A.md", "lost", first.hash)).rejects.toThrow("The disk is full.");
    expect((await files.read("A.md")).text).toBe("kept");
    // And the queue goes on.
    await expect(files.write("A.md", "next", first.hash)).resolves.toMatchObject({ text: "next" });
  });

  it("hands a large folder over in batches", async () => {
    const files = new OpfsFiles(new FakeDirectory());
    for (let n = 0; n < 1_201; n++) await files.write(`Notes/${String(n)}.md`, "", "");
    const sizes: number[] = [];
    await files.list("", (batch) => sizes.push(batch.length));
    expect(sizes).toEqual([500, 500, 201]);
  });

  it("lists nothing for a folder that is not there", async () => {
    const files = new OpfsFiles(new FakeDirectory());
    const found: unknown[] = [];
    await files.list("Nowhere", (batch) => found.push(...batch));
    expect(found).toEqual([]);
    expect(await files.folders("Nowhere")).toEqual([]);
  });

  it("stops watching when asked", async () => {
    const files = new OpfsFiles(new FakeDirectory());
    const stop = new AbortController();
    const events: FileEvent[] = [];
    const watching = files.watch((batch) => events.push(...batch), stop.signal);
    await files.write("A.md", "a", "");
    stop.abort();
    await watching;
    await files.write("B.md", "b", "");
    expect(events).toEqual([{ op: "create", path: "A.md", isDir: false }]);
  });
});
