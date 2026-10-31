// Bringing a vault's notes and the server's list together, by what the two
// last agreed on.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  isEmptyPlan,
  reconcilePaths,
  removeVaultPath,
  setVaultPath,
  vaultPaths,
} from "../src/paths.ts";

const map = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("reconcilePaths", () => {
  it("changes nothing when both sides agree", () => {
    const paths = map({ a: "A.md", b: "B.md" });
    const plan = reconcilePaths(paths, paths, paths);
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it("sends notes made here, and fetches notes made elsewhere", () => {
    const plan = reconcilePaths(map({}), map({ a: "A.md" }), map({ b: "B.md" }));
    expect(plan.upload).toEqual(["a"]);
    expect(plan.download).toEqual([{ id: "b", path: "B.md" }]);
    expect(isEmptyPlan(plan)).toBe(false);
  });

  it("moves a note moved on one side, and the server's way when moved on both", () => {
    const base = map({ a: "A.md", b: "B.md", c: "C.md" });
    const local = map({ a: "Here/A.md", b: "B.md", c: "Here/C.md" });
    const remote = map({ a: "A.md", b: "There/B.md", c: "There/C.md" });
    const plan = reconcilePaths(base, local, remote);
    expect(plan.moveRemote).toEqual([{ id: "a", path: "Here/A.md" }]);
    expect(plan.moveLocal).toEqual([
      { id: "b", path: "There/B.md" },
      { id: "c", path: "There/C.md" },
    ]);
  });

  it("removes a note removed on one side, unless the other moved it since", () => {
    const base = map({ a: "A.md", b: "B.md", c: "C.md", d: "D.md" });
    // a removed elsewhere; b removed here; c removed elsewhere but moved here; d removed here but moved elsewhere.
    const local = map({ a: "A.md", c: "Moved/C.md" });
    const remote = map({ b: "B.md", d: "Moved/D.md" });
    const plan = reconcilePaths(base, local, remote);
    expect(plan.removeLocal).toEqual(["a"]);
    expect(plan.removeRemote).toEqual(["b"]);
    expect(plan.upload).toEqual(["c"]);
    expect(plan.download).toEqual([{ id: "d", path: "Moved/D.md" }]);
  });
});

describe("the vault document", () => {
  it("lists notes by ID, moved and removed in it, merging two devices' changes", () => {
    const one = new Y.Doc();
    const two = new Y.Doc();
    setVaultPath(one, "a", "A.md");
    setVaultPath(two, "b", "B.md");
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
    Y.applyUpdate(one, Y.encodeStateAsUpdate(two));
    expect(vaultPaths(one)).toEqual(map({ a: "A.md", b: "B.md" }));
    setVaultPath(one, "a", "Moved/A.md");
    removeVaultPath(one, "b");
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
    expect(vaultPaths(two)).toEqual(map({ a: "Moved/A.md" }));
    // Setting a note to the path it has changes nothing.
    const before = Y.encodeStateVector(two);
    setVaultPath(two, "a", "Moved/A.md");
    expect(Y.encodeStateVector(two)).toEqual(before);
  });
});
