// A folder of Markdown, as an Obsidian vault or any folder of notes is,
// and Markdown files chosen alone: each note's text brought over byte for
// byte, its files beside it, every path as it was under the folder the
// import goes in, so links by name or by relative path still find what
// they named. Obsidian's settings, in its hidden `.obsidian` folder, stay
// behind, as the source lists no hidden files.
import { type ImportPlan, type ImportSource, isMarkdown, notePath, within } from "./plan.ts";

/** Plans a folder's import into the vault's folder `into`. */
export async function planFolder(source: ImportSource, into: string): Promise<ImportPlan> {
  const notes = [];
  const files = [];
  for (const file of source.files) {
    if (isMarkdown(file.path)) {
      notes.push({
        path: within(into, notePath(file.path)),
        text: await source.readText(file.path),
      });
    } else {
      files.push({ from: file.path, to: within(into, file.path) });
    }
  }
  return { notes, files, warnings: [] };
}
