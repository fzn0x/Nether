// Who is editing a note at once (ADR 0043): each person's color, beside
// their caret and behind their name, from their account's ID, so it is the
// same on every device. White text on each of them meets WCAG AA's 4.5:1.

export const presenceColors = [
  "#b4232c",
  "#8a4b00",
  "#2f6b1f",
  "#1d5c94",
  "#6b3fa0",
  "#9a1b6e",
  "#0f6b6b",
  "#5c5a14",
] as const;

/** A person's color, from their account's ID. */
export function colorFor(id: string): string {
  let hash = 0;
  for (let at = 0; at < id.length; at++) hash = (hash * 31 + id.charCodeAt(at)) >>> 0;
  return presenceColors[hash % presenceColors.length] ?? presenceColors[0];
}
