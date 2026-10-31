// Attachments: the plan that brings a vault's files and the server's list
// together, the paths sync takes, files' encryption, and devices syncing
// files through a real Nether server.
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { decryptFile, encryptFile, newWorkspaceKey } from "../src/crypto.ts";
import {
  besidePath,
  isSyncedFile,
  reconcileFiles,
  setVaultFile,
  sha256,
  vaultFiles,
} from "../src/files.ts";
import {
  MemoryVault,
  device,
  signIn,
  startServer,
  stopAll,
  storedBlobs,
  until,
} from "./harness.ts";

afterEach(stopAll);

const map = (entries: Record<string, string>) => new Map(Object.entries(entries));
const hash = (n: number) => String(n).repeat(64).slice(0, 64);

describe("reconcileFiles", () => {
  it("sends what changed here, fetches what changed there, and keeps both of what changed on both", () => {
    const base = map({
      same: "1",
      here: "1",
      there: "1",
      both: "1",
      goneHere: "1",
      goneThere: "1",
    });
    const local = map({ same: "1", here: "2", there: "1", both: "2", goneThere: "1", made: "1" });
    const remote = map({ same: "1", here: "1", there: "2", both: "3", goneHere: "1", new: "1" });
    expect(reconcileFiles(base, local, remote)).toEqual({
      upload: ["here", "made"],
      download: ["there", "new"],
      removeRemote: ["goneHere"],
      removeLocal: ["goneThere"],
      conflict: ["both"],
    });
  });

  it("keeps a file removed on one side and changed on the other, and two made at one path", () => {
    const base = map({ editedHere: "1", editedThere: "1" });
    const local = map({ editedHere: "2", twice: "a" });
    const remote = map({ editedThere: "2", twice: "b" });
    expect(reconcileFiles(base, local, remote)).toEqual({
      upload: ["editedHere"],
      download: ["editedThere"],
      removeRemote: [],
      removeLocal: [],
      conflict: ["twice"],
    });
  });
});

describe("the paths sync takes", () => {
  it("takes files in the vault that every system can name, and no note or hidden file", () => {
    for (const path of ["a.png", "attachments/Diagram 1.svg", "Projects/Plan.base", "naïve.pdf"]) {
      expect(isSyncedFile(path)).toBe(true);
    }
    for (const path of [
      "Note.md",
      "Folder/Note.MD",
      ".obsidian/plugins/x/main.js",
      "a/.nether/index",
      ".trash/a.png",
      "../a.png",
      "/etc/passwd",
      "a//b.png",
      "a\\b.png",
      "C:/a.png",
      "a.png:stream",
      "a\u0000.png",
      "bad.",
      "space ",
      "aux.png",
      "Folder/COM1",
    ]) {
      expect(isSyncedFile(path), path).toBe(false);
    }
  });

  it("lists only well-formed files at paths sync takes", () => {
    const document = new Y.Doc();
    setVaultFile(document, "a.png", { hash: hash(1), blob: hash(2) });
    const files = document.getMap("files");
    files.set(".obsidian/plugins/x/main.js", { hash: hash(1), blob: hash(1) });
    files.set("b.png", { hash: "short", blob: hash(1) });
    files.set("c.png", "not a file");
    expect(vaultFiles(document)).toEqual(new Map([["a.png", { hash: hash(1), blob: hash(2) }]]));

    // Setting what is there already changes nothing.
    let updates = 0;
    document.on("update", () => updates++);
    setVaultFile(document, "a.png", { hash: hash(1), blob: hash(2) });
    expect(updates).toBe(0);
  });

  it("puts a file aside under the first free numbered name", () => {
    const taken = new Set(["a 1.png"]);
    expect(besidePath("a.png", (path) => taken.has(path))).toBe("a 2.png");
    expect(besidePath("folder.v2/README", () => false)).toBe("folder.v2/README 1");
  });
});

describe("files' encryption", () => {
  it("encrypts the same bytes the same way under a key, and opens only with it", async () => {
    const key = { version: 3, key: await newWorkspaceKey() };
    const bytes = new TextEncoder().encode("a photo's bytes");
    const sealed = await encryptFile(bytes, key);
    expect(await encryptFile(bytes, key)).toEqual(sealed);
    expect(await encryptFile(bytes, { version: 3, key: await newWorkspaceKey() })).not.toEqual(
      sealed,
    );
    expect(Buffer.from(sealed).includes(Buffer.from("photo"))).toBe(false);
    expect(await decryptFile(sealed, new Map([[3, key.key]]))).toEqual(bytes);

    await expect(decryptFile(sealed, new Map([[3, await newWorkspaceKey()]]))).rejects.toThrow(
      "does not open",
    );
    await expect(decryptFile(sealed, new Map())).rejects.toThrow("no key of version 3");
    await expect(decryptFile(new Uint8Array([9]), new Map())).rejects.toThrow("not an encrypted");
  });
});

describe("syncing files", () => {
  it("sends a vault's files once each, and writes them on another device", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    laptop.write("Trip.md", "![[photo.png]]");
    laptop.attach("photo.png", new Uint8Array([137, 80, 78, 71, 0, 255]));
    laptop.attach("copies/photo.png", new Uint8Array([137, 80, 78, 71, 0, 255]));
    laptop.attach("Trip.base", "views: []\n");
    // Not synced: a file sync does not take.
    laptop.attach(".obsidian/app.json", "{}");
    const first = await device(served, served.token, laptop);
    await until(() => first.engine.status.state === "synced" && storedBlobs().blobs.size === 2);

    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.attachments.size === 3);
    expect(phone.vault.attachments.get("copies/photo.png")).toEqual(
      laptop.attachments.get("photo.png"),
    );
    expect(phone.vault.file("Trip.base")).toBe("views: []\n");
    expect(phone.vault.attachments.has(".obsidian/app.json")).toBe(false);
    // Kept once, by the hash of its bytes.
    const photo = await sha256(new Uint8Array([137, 80, 78, 71, 0, 255]));
    expect([...storedBlobs().blobs.keys()].some((key) => key.endsWith(`/${photo}`))).toBe(true);
    await until(() => Object.keys(first.store.record?.files ?? {}).length === 3);
  });

  it("changes, moves and removes on one device the files another did", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    laptop.attach("a.png", "one");
    laptop.attach("b.png", "bee");
    laptop.attach("c.png", "sea");
    await device(served, served.token, laptop);
    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.attachments.size === 3);

    laptop.attach("a.png", "two");
    phone.vault.detach("b.png");
    laptop.detach("c.png");
    laptop.attach("moved/c.png", "sea");
    await until(
      () =>
        phone.vault.file("a.png") === "two" &&
        !laptop.attachments.has("b.png") &&
        phone.vault.file("moved/c.png") === "sea" &&
        !phone.vault.attachments.has("c.png"),
    );
    expect([...phone.vault.attachments.keys()].sort()).toEqual(["a.png", "moved/c.png"]);
    expect([...laptop.attachments.keys()].sort()).toEqual(["a.png", "moved/c.png"]);
  });

  it("keeps both versions of a file changed on two devices while one was offline", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    laptop.attach("map.png", "first");
    await device(served, served.token, laptop);
    const token = await signIn(served.url);
    const phone = await device(served, token);
    await until(() => phone.vault.file("map.png") === "first");

    await phone.engine.stop();
    phone.vault.attach("map.png", "drawn on the phone");
    laptop.attach("map.png", "drawn on the laptop");
    await until(() => storedBlobs().blobs.size === 2);

    // The phone's own moves aside, and both devices end with both.
    await device(served, token, phone.vault, phone.store);
    const both = (vault: MemoryVault) =>
      vault.file("map.png") === "drawn on the laptop" &&
      vault.file("map 1.png") === "drawn on the phone";
    await until(() => both(phone.vault) && both(laptop));
  });

  it("sends a file changed here as soon as it was fetched, rather than keeping it twice", async () => {
    const served = await startServer();
    const laptop = new MemoryVault();
    laptop.attach("a.png", "one");
    laptop.attach("b.png", "bee");
    await device(served, served.token, laptop);

    class Hasty extends MemoryVault {
      override async writeFile(path: string, data: Uint8Array, base: string): Promise<void> {
        await super.writeFile(path, data, base);
        if (path === "a.png") this.attach("a.png", "changed");
      }
    }
    const phone = await device(served, await signIn(served.url), new Hasty());
    await until(() => laptop.file("a.png") === "changed" && phone.vault.attachments.size === 2);
    expect([...laptop.attachments.keys()].sort()).toEqual(["a.png", "b.png"]);
    expect([...phone.vault.attachments.keys()].sort()).toEqual(["a.png", "b.png"]);
  });

  it("passes over a file larger than the server takes, and syncs the rest", async () => {
    const served = await startServer({ NETHER_ATTACHMENT_LIMIT: "1" });
    const laptop = new MemoryVault();
    laptop.attach("video.mp4", new Uint8Array(1024 * 1024 + 1));
    laptop.attach("small.png", "small");
    const first = await device(served, served.token, laptop);
    await until(() => first.engine.status.refused?.includes("video.mp4") === true);

    const phone = await device(served, await signIn(served.url));
    await until(() => phone.vault.file("small.png") === "small");
    expect(phone.vault.attachments.has("video.mp4")).toBe(false);

    // Made smaller, it is sent, and no longer refused.
    laptop.attach("video.mp4", new Uint8Array(1024));
    await until(() => phone.vault.attachments.get("video.mp4")?.length === 1024);
    await until(() => first.engine.status.refused === undefined);
  });
});
