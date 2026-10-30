import { describe, expect, it } from "vitest";
import { directionOf, t } from "../src/messages.ts";

describe("messages", () => {
  it("fill in their placeholders, and leave unknown ones", () => {
    expect(t("forgetVault", { name: "Work" })).toBe("Remove Work from this list");
    expect(t("forgetVault")).toBe("Remove {name} from this list");
  });

  it("know the direction of a language, by its first subtag", () => {
    expect(directionOf("en")).toBe("ltr");
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("he-IL")).toBe("rtl");
    expect(directionOf("FA")).toBe("rtl");
    expect(directionOf("ur-PK")).toBe("rtl");
    expect(directionOf("tr")).toBe("ltr");
    expect(directionOf("")).toBe("ltr");
  });
});
