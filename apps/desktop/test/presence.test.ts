// Each person's color beside their caret: the same for an account
// everywhere, from a small set, each dark enough for white text.
import { describe, expect, it } from "vitest";
import { colorFor, presenceColors } from "../src/presence.ts";

/** The relative luminance of a color, as WCAG works it out. */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

describe("colorFor", () => {
  it("gives an account the same color each time, from the set", () => {
    const id = "01929f4c-7b00-7a00-8000-000000000001";
    expect(colorFor(id)).toBe(colorFor(id));
    expect(presenceColors).toContain(colorFor(id));
    const many = new Set(Array.from({ length: 40 }, (_, n) => colorFor(`account-${String(n)}`)));
    expect(many.size).toBeGreaterThan(4);
  });

  it("keeps white names on every color at 4.5:1 or more", () => {
    for (const color of presenceColors) {
      expect((1.05 / (luminance(color) + 0.05)).toFixed(2), color).toSatisfy(
        (ratio: string) => Number(ratio) >= 4.5,
      );
    }
  });
});
