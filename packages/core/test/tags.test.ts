import { describe, expect, it } from "vitest";
import { isTagName } from "../src/index.ts";

describe("isTagName", () => {
  it.each(["project", "area/research", "déjà-vu", "café", "a_b", "2026-review", "中文"])(
    "accepts %j",
    (name) => {
      expect(isTagName(name)).toBe(true);
    },
  );

  it.each(["", "2026", "a//b", "/a", "a/", "#tag", "a b", "a😀", "a.b"])("rejects %j", (name) => {
    expect(isTagName(name)).toBe(false);
  });
});
