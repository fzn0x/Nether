// Carries out an import (ADR 0027): what the user chose is read, its
// importer plans the notes and files to make, and the plan is made in the
// vault, in a folder named after what was chosen that the vault does not
// have yet, or under names it does not have: nothing already in the vault
// is changed.
import { type ImportPlan, planCsv, planFolder, planNotion, safeName } from "@nether/markdown";
import type { Vault } from "@nether/storage";
import type { ImportKind, OpenedImport } from "./backend.ts";

/** What the import dialog offers, and the kind of thing each asks the user for. */
export const importChoices = {
  folder: "folder",
  notion: "zip",
  markdown: "markdown",
  csv: "csv",
} as const satisfies Readonly<Record<string, ImportKind>>;

export type ImportChoice = keyof typeof importChoices;

/** What an import made. */
export interface ImportResult {
  readonly notes: number;
  readonly files: number;
  readonly warnings: readonly string[];
  /** The folder it went in; "" for the vault's top. */
  readonly folder: string;
  /** The path of the first note it made, to open. */
  readonly first?: string;
}

/** A name for a folder or note at the vault's top that nothing there has yet: the name, or with a number after it. */
export function freeTop(vault: Vault, name: string, also: ReadonlySet<string> = new Set()): string {
  const paths = [...vault.notes().map((note) => note.path), ...vault.files()].map((path) =>
    path.toLowerCase(),
  );
  const taken = (candidate: string) => {
    const lower = candidate.toLowerCase();
    return (
      also.has(lower) ||
      paths.some((path) => path === lower || path === `${lower}.md` || path.startsWith(`${lower}/`))
    );
  };
  for (let count = 1; ; count++) {
    const candidate = count === 1 ? name : `${name} ${String(count)}`;
    if (!taken(candidate)) return candidate;
  }
}

/** What an import of the chosen kind will make, and the folder it goes in. */
export async function planImport(
  vault: Vault,
  choice: ImportChoice,
  opened: OpenedImport,
): Promise<{ readonly plan: ImportPlan; readonly folder: string }> {
  if (choice === "csv") {
    // Each table a database at the vault's top, named after its file.
    const names = new Set<string>();
    const plans: ImportPlan[] = [];
    for (const file of opened.files) {
      const name = freeTop(vault, safeName(file.path.replace(/\.csv$/i, ""), "Table"), names);
      names.add(name.toLowerCase());
      plans.push(planCsv(name, await opened.readText(file.path), ""));
    }
    return {
      plan: {
        notes: plans.flatMap((plan) => plan.notes),
        files: [],
        warnings: plans.flatMap((plan) => plan.warnings),
      },
      folder: "",
    };
  }
  if (choice === "notion") {
    // Notion names its exports by IDs: the folder is named after Notion instead.
    const folder = freeTop(vault, "Notion");
    return { plan: await planNotion(opened, folder), folder };
  }
  const folder = freeTop(
    vault,
    choice === "folder" ? safeName(opened.name, "Imported") : "Imported",
  );
  return { plan: await planFolder(opened, folder), folder };
}

/** Makes a plan's notes and copies its files, telling how far it has come. */
export async function runImport(
  vault: Vault,
  opened: OpenedImport,
  planned: { readonly plan: ImportPlan; readonly folder: string },
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ImportResult> {
  const { plan, folder } = planned;
  const total = plan.notes.length + plan.files.length;
  let done = 0;
  for (const note of plan.notes) {
    signal?.throwIfAborted();
    await vault.create(note.path, note.text);
    onProgress?.(++done, total);
  }
  for (const file of plan.files) {
    signal?.throwIfAborted();
    await opened.copyInto(file.from, file.to);
    onProgress?.(++done, total);
  }
  const first = plan.notes[0]?.path;
  return {
    notes: plan.notes.length,
    files: plan.files.length,
    warnings: plan.warnings,
    folder,
    ...(first === undefined ? {} : { first }),
  };
}
