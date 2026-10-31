// What each build shows: a release, made without VITE_NETHER_SYNC, leaves
// sync's commands out; the web app shows sync and leaves out what a page
// in a browser cannot do.
import { describe, expect, it } from "vitest";
import { commandIds } from "../src/commands.ts";
import { build, commandShown, shownEntries, shownIn, syncShown } from "../src/features.ts";

describe("commandShown", () => {
  it("leaves sync out of a build without the flag", () => {
    expect(syncShown).toBe(false);
    expect(build.web).toBe(false);
    for (const id of ["servers", "sync", "members", "spaces", "share", "notifications"] as const) {
      expect(commandShown(id)).toBe(false);
    }
    expect(commandIds.filter(commandShown)).toHaveLength(commandIds.length - 6);
    expect(commandShown("newNote")).toBe(true);
  });

  it("shows everything with the flag", () => {
    expect(commandIds.filter((id) => shownIn({ web: false, sync: true }, id))).toEqual(commandIds);
  });

  it("shows the web app sync, without linking, updates or import", () => {
    const web = { web: true, sync: true };
    for (const id of [
      "servers",
      "members",
      "spaces",
      "share",
      "notifications",
      "export",
    ] as const) {
      expect(shownIn(web, id)).toBe(true);
    }
    for (const id of ["sync", "checkUpdates", "updateChecks", "import"] as const) {
      expect(shownIn(web, id)).toBe(false);
    }
    expect(commandIds.filter((id) => shownIn(web, id))).toHaveLength(commandIds.length - 4);
  });
});

describe("shownEntries", () => {
  it("leaves out what a build does not show, and the separators that strands", () => {
    const web = (id: (typeof commandIds)[number]) => shownIn({ web: true, sync: true }, id);
    expect(
      shownEntries(["newNote", "separator", "import", "export", "separator", "closeVault"], web),
    ).toEqual(["newNote", "separator", "export", "separator", "closeVault"]);
    expect(
      shownEntries(["templateSettings", "separator", "checkUpdates", "updateChecks"], web),
    ).toEqual(["templateSettings"]);
    expect(shownEntries(["separator", "import", "separator", "newNote"], web)).toEqual(["newNote"]);
  });
});
