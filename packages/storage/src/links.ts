// Which file a link names, read the way Obsidian reads it, so links written
// in either app find the same files. Case does not matter, as on the
// desktops most vaults live on.

/** Sorts as a file explorer does: case aside, and numbers by their value. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * A link as a path in the vault: `.` and `..` worked out, and `undefined`
 * when it climbs out of the vault or names no file.
 */
export function normalizeLink(link: string): string | undefined {
  const parts: string[] = [];
  for (const part of link.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.pop() === undefined) return undefined;
      continue;
    }
    parts.push(part);
  }
  return parts.length === 0 ? undefined : parts.join("/");
}

/** How many folders, from the vault down, two folders share. */
function shared(a: string, b: string): number {
  const left = a === "" ? [] : a.split("/");
  const right = b === "" ? [] : b.split("/");
  let count = 0;
  while (count < left.length && left[count]?.toLowerCase() === right[count]?.toLowerCase()) count++;
  return count;
}

/**
 * Paths under a key: the path alone while it is the only one, as it is for
 * almost every key, since a list for each took megabytes in a large vault.
 */
type Paths = string | string[];

function addPath(map: Map<string, Paths>, key: string, path: string): void {
  const paths = map.get(key);
  if (paths === undefined) map.set(key, path);
  else if (typeof paths === "string") map.set(key, [paths, path]);
  else paths.push(path);
}

function removePath(map: Map<string, Paths>, key: string, path: string): void {
  const paths = map.get(key);
  if (paths === undefined || typeof paths === "string") {
    if (paths === path) map.delete(key);
    return;
  }
  const at = paths.indexOf(path);
  if (at !== -1) paths.splice(at, 1);
  const [only] = paths;
  if (paths.length === 1 && only !== undefined) map.set(key, only);
}

function pathList(paths: Paths | undefined): readonly string[] {
  return paths === undefined ? [] : typeof paths === "string" ? [paths] : paths;
}

/** The vault's files, indexed to find the one a link names. */
export class LinkIndex {
  /** Lowercase path to the paths that match it. */
  readonly #folded = new Map<string, Paths>();
  /** Lowercase file name to the paths of files with that name. */
  readonly #names = new Map<string, Paths>();

  constructor(paths: Iterable<string>) {
    for (const path of paths) this.add(path);
  }

  /** Adds a file, as one that appears in the vault. */
  add(path: string): void {
    const folded = path.toLowerCase();
    addPath(this.#folded, folded, path);
    addPath(this.#names, baseName(folded), path);
  }

  /** Forgets a file, as one that leaves the vault or moves from its path. */
  remove(path: string): void {
    const folded = path.toLowerCase();
    removePath(this.#folded, folded, path);
    removePath(this.#names, baseName(folded), path);
  }

  /** The file at a path, as written or else case aside. */
  #exact(path: string): string | undefined {
    const paths = this.#folded.get(path.toLowerCase());
    if (paths === undefined || typeof paths === "string") return paths;
    return paths.includes(path) ? path : paths[0];
  }

  /**
   * The path of the file `link` names, from the note at `from`: the file
   * the link names from the note's folder, then from the vault's own
   * folder, then any file whose path ends with the link, the nearest to
   * the note first. A link that starts with `/` names a path from the
   * vault's folder only.
   */
  resolve(link: string, from: string): string | undefined {
    const trimmed = link.trim();
    const target = normalizeLink(trimmed);
    if (trimmed.startsWith("/")) return target === undefined ? undefined : this.#exact(target);

    // `../photo.png` names a file from the note's folder, though not from the vault's.
    const folder = folderOf(from);
    const nearby = folder === "" ? undefined : normalizeLink(`${folder}/${trimmed}`);
    const direct =
      (nearby === undefined ? undefined : this.#exact(nearby)) ??
      (target === undefined ? undefined : this.#exact(target));
    if (direct !== undefined || target === undefined) return direct;

    const ending = `/${target.toLowerCase()}`;
    const matches = pathList(this.#names.get(baseName(target).toLowerCase())).filter((path) =>
      `/${path.toLowerCase()}`.endsWith(ending),
    );
    matches.sort(
      (a, b) =>
        shared(folderOf(b), folder) - shared(folderOf(a), folder) ||
        a.split("/").length - b.split("/").length ||
        collator.compare(a, b) ||
        (a < b ? -1 : 1),
    );
    return matches[0];
  }

  /**
   * How many files have a name, case aside. A link that is a name alone
   * finds the same file from every note when one file has it, or none.
   */
  named(name: string): number {
    return pathList(this.#names.get(name.toLowerCase())).length;
  }

  /**
   * The shortest link to the file at `path` from the note at `from`: its
   * name, when that finds it, as Obsidian writes links, or else its path.
   */
  linkTo(path: string, from: string): string {
    const name = baseName(path);
    return this.resolve(name, from) === path ? name : path;
  }
}
