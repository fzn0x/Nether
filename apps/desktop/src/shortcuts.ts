// Keyboard shortcuts as the app writes and reads them: `Mod+Shift+F`, where
// Mod is Cmd on a Mac and Ctrl elsewhere. A key event becomes such a text,
// a text shows as the platform writes it, and a vault's own choices, kept
// in `.nether/hotkeys.json`, override the defaults command by command.

/** Whether the app runs on a Mac, where Mod is Cmd and Ctrl is a key of its own. */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

const modifiers = new Set(["Control", "Meta", "Alt", "Shift", "AltGraph", "CapsLock", "OS"]);

/** The key of an event, its letter upper case; undefined for a modifier alone. */
function keyName(key: string): string | undefined {
  if (modifiers.has(key) || key === "Dead" || key === "Unidentified") return undefined;
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A key event as a shortcut, `Mod+Shift+F`; undefined while only modifiers are down. */
export function eventKeys(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  mac = isMac(),
): string | undefined {
  const key = keyName(event.key);
  if (key === undefined) return undefined;
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push("Mod");
  if (mac && event.ctrlKey) parts.push("Ctrl");
  if (!mac && event.metaKey) parts.push("Meta");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

const macSymbols: Readonly<Record<string, string>> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

/** A shortcut as the platform writes it: `Ctrl+Shift+F`, or `⇧⌘F` on a Mac. */
export function formatKeys(keys: string, mac = isMac()): string {
  const parts = keys.split("+");
  if (!mac) return parts.map((part) => (part === "Mod" ? "Ctrl" : part)).join("+");
  const key = parts.pop() ?? "";
  // A Mac writes ⌃⌥⇧⌘ in that order, before the key.
  const order = ["Ctrl", "Alt", "Shift", "Mod"];
  return `${order
    .filter((part) => parts.includes(part))
    .map((part) => macSymbols[part] ?? part)
    .join("")}${key}`;
}

/** What `aria-keyshortcuts` names a shortcut as: Control or Meta for Mod, as the platform has it. */
export function ariaKeys(keys: string, mac = isMac()): string {
  return keys
    .split("+")
    .map((part) =>
      part === "Mod" ? (mac ? "Meta" : "Control") : part === "Ctrl" ? "Control" : part,
    )
    .join("+");
}

/** Each command's shortcuts: the defaults, with the vault's own choices over them. */
export type Hotkeys = Readonly<Record<string, readonly string[]>>;

/** The vault's choices from `.nether/hotkeys.json`, leaving out what is not a list of shortcuts. */
export function readHotkeys(value: unknown): Hotkeys {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((keys) => typeof keys === "string"),
    ),
  );
}

/** The shortcuts each command has: the vault's choice for it, or its default. */
export function resolveHotkeys(defaults: Hotkeys, chosen: Hotkeys): Hotkeys {
  return { ...defaults, ...chosen };
}

/** The command a shortcut runs, if any. */
export function commandFor(hotkeys: Hotkeys, keys: string): string | undefined {
  const lower = keys.toLowerCase();
  return Object.keys(hotkeys).find((id) =>
    (hotkeys[id] ?? []).some((each) => each.toLowerCase() === lower),
  );
}
