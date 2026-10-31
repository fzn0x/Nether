// A build made without VITE_NETHER_SYNC, as a release is: sync's commands
// are left out, and every other command shows.
import { describe, expect, it } from "vitest";
import { commandIds } from "../src/commands.ts";
import { commandShown, syncShown } from "../src/features.ts";

describe("commandShown", () => {
  it("leaves sync out of a build without the flag", () => {
    expect(syncShown).toBe(false);
    for (const id of ["servers", "sync", "members", "spaces", "share", "notifications"] as const) {
      expect(commandShown(id)).toBe(false);
    }
    expect(commandIds.filter(commandShown)).toHaveLength(commandIds.length - 6);
    expect(commandShown("newNote")).toBe(true);
  });
});
