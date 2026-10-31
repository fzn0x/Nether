// A vault's appearance (ADR 0026): light, dark or as the system, a theme
// from `.nether/themes`, and the CSS snippets turned on from
// `.nether/snippets`, kept in `.nether/appearance.json`. Themes and
// snippets are CSS files put on the page after the app's own styles, the
// theme first, so they override its design tokens and anything else; the
// page's `data-mode` says whether it shows light or dark, for them to follow.
import type { Vault } from "@nether/storage";
import type { Effect } from "./ThemeEffect.tsx";
import animeCss from "./themes/anime.css?inline";
import pixelsCss from "./themes/pixels.css?inline";

export type Mode = "system" | "light" | "dark";

export interface Appearance {
  readonly mode: Mode;
  /** The theme's name, its file's without `.css`; Nether's own without one. */
  readonly theme?: string;
  /** The snippets turned on, by name, in the order they apply. */
  readonly snippets: readonly string[];
}

export const themesFolder = ".nether/themes";
export const snippetsFolder = ".nether/snippets";

export const defaultAppearance: Appearance = { mode: "system", snippets: [] };

/**
 * The themes Nether has itself (ADR 0049), each a stylesheet and an effect
 * drawn behind the app. Their names have a colon, which no file's name in
 * `.nether/themes` can have on every system, so they never meet a vault's.
 */
export const builtInThemes = [
  { id: "nether:anime", label: "themeAnime", css: animeCss, effect: "kana" },
  { id: "nether:pixels", label: "themePixels", css: pixelsCss, effect: "pixels" },
] as const satisfies readonly {
  id: string;
  label: string;
  css: string;
  effect: Effect;
}[];

export type BuiltInTheme = (typeof builtInThemes)[number];

/** The built-in theme a name is, if it is one. */
export function builtInTheme(name: string | undefined): BuiltInTheme | undefined {
  return builtInThemes.find((theme) => theme.id === name);
}

/** An appearance as `.nether/appearance.json` holds it, what cannot be read left as the default. */
export function readAppearance(data: unknown): Appearance {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return defaultAppearance;
  const value = data as Record<string, unknown>;
  const mode = value.mode === "light" || value.mode === "dark" ? value.mode : "system";
  const snippets = Array.isArray(value.snippets)
    ? [
        ...new Set(
          value.snippets.filter(
            (name: unknown): name is string => typeof name === "string" && name !== "",
          ),
        ),
      ]
    : [];
  return {
    mode,
    ...(typeof value.theme === "string" && value.theme !== "" ? { theme: value.theme } : {}),
    snippets,
  };
}

/** The names of the CSS files in a folder of the vault's own, without `.css`. */
async function stylesIn(vault: Vault, folder: string): Promise<string[]> {
  return (await vault.filesIn(folder))
    .filter((path) => path.lastIndexOf("/") === folder.length && /\.css$/i.test(path))
    .map((path) => path.slice(folder.length + 1, -4));
}

/** The themes and snippets the vault has, by name. */
export async function availableStyles(
  vault: Vault,
): Promise<{ readonly themes: readonly string[]; readonly snippets: readonly string[] }> {
  const [themes, snippets] = await Promise.all([
    stylesIn(vault, themesFolder),
    stylesIn(vault, snippetsFolder),
  ]);
  return { themes, snippets };
}

export async function loadAppearance(vault: Vault): Promise<Appearance> {
  return readAppearance(await vault.readData("appearance"));
}

export function saveAppearance(vault: Vault, appearance: Appearance): Promise<void> {
  return vault.writeData("appearance", appearance);
}

/** Whether the page shows light or dark, for a mode and what the system prefers. */
export function shownMode(mode: Mode, systemDark: boolean): "light" | "dark" {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

// What stops the page following the system's light or dark, when it does.
let stopFollowing: (() => void) | undefined;

/**
 * Shows the page light, dark, or as the system does, following the system
 * as it changes, in place of the mode before.
 */
export function applyMode(mode: Mode): void {
  stopFollowing?.();
  stopFollowing = undefined;
  const query = matchMedia("(prefers-color-scheme: dark)");
  const show = () => {
    document.documentElement.dataset.mode = shownMode(mode, query.matches);
  };
  show();
  if (mode !== "system") return;
  query.addEventListener("change", show);
  stopFollowing = () => {
    query.removeEventListener("change", show);
  };
}

/** A theme's or a snippet's CSS, as the page takes it: its text, or nothing for a file that is not there. */
async function cssOf(vault: Vault, path: string): Promise<string | undefined> {
  const file = await vault.readFile(path);
  return file.missing === true || file.binary === true ? undefined : file.text;
}

/** The style elements a vault's appearance puts on the page, by what they hold. */
const styleClass = "nether-appearance";

/**
 * Puts a vault's theme and snippets on the page, in place of those before
 * them, and returns the names of those it could not read.
 */
export async function applyStyles(vault: Vault, appearance: Appearance): Promise<string[]> {
  const wanted = [
    ...(appearance.theme === undefined
      ? []
      : [{ kind: "theme", name: appearance.theme, folder: themesFolder }]),
    ...appearance.snippets.map((name) => ({ kind: "snippet", name, folder: snippetsFolder })),
  ];
  const read = await Promise.all(
    wanted.map(async (style) => ({
      ...style,
      css:
        builtInTheme(style.kind === "theme" ? style.name : undefined)?.css ??
        (await cssOf(vault, `${style.folder}/${style.name}.css`)),
    })),
  );
  for (const old of document.head.querySelectorAll(`style.${styleClass}`)) old.remove();
  const missing: string[] = [];
  for (const style of read) {
    if (style.css === undefined) {
      missing.push(style.name);
      continue;
    }
    const element = document.createElement("style");
    element.className = styleClass;
    // On screen only: a PDF prints the notes in Nether's own look.
    element.media = "screen";
    element.dataset.kind = style.kind;
    element.dataset.name = style.name;
    element.textContent = style.css;
    document.head.append(element);
  }
  return missing;
}

/** Takes the vault's theme and snippets off the page, as when it closes. */
export function removeStyles(): void {
  for (const old of document.head.querySelectorAll(`style.${styleClass}`)) old.remove();
}
