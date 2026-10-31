// Sync units (ADR 0042): General, teamspaces, private spaces and pages
// shared on their own, each with its own vault document, which the engine
// syncs for those the account opens. A note or file belongs to the unit
// whose area holds its path: a teamspace's top-level folder, the private
// space's `Private` folder, or a shared page and the folder beside it
// (ADR 0013), the deepest first; anything else is General's.

export type Level = "view" | "comment" | "edit" | "full";

/** A unit the account opens, as the server lists it. */
export interface SyncUnit {
  /** `general`, or the unit's ID. */
  readonly id: string;
  readonly kind: "general" | "team" | "private" | "page";
  readonly level: Level;
  /** Its vault document's name, after the workspace's ID. */
  readonly document: string;
  /** A teamspace's name, which its folder has. */
  readonly name?: string;
  /** A shared page's note. */
  readonly rootNote?: string;
}

export const general = "general";

/** What the engine knows before the server says: General, as before units. */
export const generalOnly: readonly SyncUnit[] = [
  { id: general, kind: "general", level: "full", document: "vault" },
];

const kinds = new Set(["general", "team", "private", "page"]);
const levels = new Set(["view", "comment", "edit", "full"]);

/** The units in a server's answer, leaving out any it cannot read. */
export function readUnits(answer: unknown): SyncUnit[] {
  const list = (answer as { units?: unknown } | null)?.units;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    const unit = item as Record<string, unknown> | null;
    if (
      typeof unit !== "object" ||
      unit === null ||
      typeof unit.id !== "string" ||
      typeof unit.document !== "string" ||
      !kinds.has(String(unit.kind)) ||
      !levels.has(String(unit.level))
    ) {
      return [];
    }
    return [
      {
        id: unit.id,
        kind: unit.kind as SyncUnit["kind"],
        level: unit.level as Level,
        document: unit.document,
        ...(typeof unit.name === "string" ? { name: unit.name } : {}),
        ...(typeof unit.rootNote === "string" ? { rootNote: unit.rootNote } : {}),
      },
    ];
  });
}

/** Whether a unit's level changes its notes. */
export function writes(unit: SyncUnit | undefined): boolean {
  return unit?.level === "edit" || unit?.level === "full";
}

/** The folder a unit's area is, or the page's path, with how deep it is. */
function areaOf(unit: SyncUnit, pagePaths: ReadonlyMap<string, string>): string | undefined {
  if (unit.kind === "team") return unit.name === undefined ? undefined : `${unit.name}/`;
  if (unit.kind === "private") return "Private/";
  if (unit.kind === "page" && unit.rootNote !== undefined) return pagePaths.get(unit.rootNote);
  return undefined;
}

/** Whether a path is in an area: under a folder, or a page or under the folder beside it. */
function inArea(path: string, area: string): boolean {
  if (area.endsWith("/")) return path.toLowerCase().startsWith(area.toLowerCase());
  const folder = `${area.replace(/\.md$/i, "")}/`;
  return path === area || path.toLowerCase().startsWith(folder.toLowerCase());
}

/**
 * The unit a path belongs to: the deepest area holding it, or General's
 * when none does; undefined when that is General and the account does not
 * open it, as a guest's. `pagePaths` gives each shared page's note its
 * path, as the vault documents list it.
 */
export function unitForPath(
  path: string,
  units: readonly SyncUnit[],
  pagePaths: ReadonlyMap<string, string>,
): SyncUnit | undefined {
  let found: SyncUnit | undefined;
  let depth = -1;
  for (const unit of units) {
    const area = areaOf(unit, pagePaths);
    if (area === undefined || !inArea(path, area)) continue;
    // How many folders down its area is: `Design/` one, `Design/Launch.md`'s two.
    const deep = area.endsWith("/")
      ? area.split("/").length - 1
      : area.replace(/\.md$/i, "").split("/").length;
    if (deep > depth) {
      found = unit;
      depth = deep;
    }
  }
  return found ?? units.find((unit) => unit.id === general);
}
