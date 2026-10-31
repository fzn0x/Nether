// A note's unlinked mentions: the other notes that write its name, or one
// of its aliases, as text without linking it, as Obsidian lists them. The
// search index finds the notes that have the words, and their files show
// where; a mention made a link changes only those words in its file.
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import { type Mention, findMentions, linkMention } from "@nether/markdown";
import { ChangedOnDisk, type NoteEntry, type Vault } from "@nether/storage";

/** How many notes the index gives for each name, whose files are read. */
const candidateLimit = 200;

/** A note that mentions another, and where. */
export interface NoteMentions {
  readonly note: NoteEntry;
  readonly mentions: readonly Mention[];
}

/** The names a note is mentioned by: its title, and its aliases. */
function namesOf(vault: Vault, graph: LinkGraph, id: NoteId): string[] {
  const title = vault.note(id)?.title;
  return [...(title === undefined ? [] : [title]), ...(graph.note(id)?.index.aliases ?? [])];
}

/** The notes that mention a note without linking to it, in the order of their paths. */
export async function unlinkedMentions(
  vault: Vault,
  graph: LinkGraph,
  id: NoteId,
): Promise<NoteMentions[]> {
  const names = namesOf(vault, graph, id);
  const candidates = new Set<NoteId>();
  for (const name of names) {
    const hits = await vault.indexes.searchText(
      { words: [], phrases: [name], excluded: [], filters: [], excludedFilters: [] },
      candidateLimit,
    );
    for (const hit of hits) if (hit.note !== id) candidates.add(hit.note);
  }
  const found: NoteMentions[] = [];
  await vault.readNotes([...candidates], (note, file) => {
    const entry = vault.note(note);
    if (entry === undefined || file.missing === true || file.binary === true) return;
    const mentions = findMentions(file.text, names);
    if (mentions.length > 0) found.push({ note: entry, mentions });
  });
  return found.sort((a, b) => a.note.path.localeCompare(b.note.path));
}

/**
 * Makes a mention of the note `id` in the note `from` a link to it, named
 * by its title, or by its path where the title finds another note from
 * there. The file is read again first, and written again if another app
 * changes it meanwhile; a mention no longer there is an error.
 */
export async function linkMentionIn(
  vault: Vault,
  graph: LinkGraph,
  id: NoteId,
  from: NoteId,
  mention: Mention,
): Promise<void> {
  const note = vault.note(id);
  const source = vault.note(from);
  if (note === undefined || source === undefined) throw new Error("The note is not in the vault.");
  const target =
    graph.resolve(note.title, source.path) === id ? note.title : note.path.replace(/\.md$/i, "");
  const names = namesOf(vault, graph, id);
  for (;;) {
    const file = await vault.read(from);
    if (file.missing === true || file.binary === true) throw new Error(`${source.title} is gone.`);
    // The same mention: where it was, or, if the file changed, as it was on its line.
    const mentions = findMentions(file.text, names);
    const same =
      mentions.find((item) => item.start === mention.start && item.text === mention.text) ??
      mentions.find(
        (item) =>
          item.line === mention.line &&
          item.column === mention.column &&
          item.text === mention.text,
      );
    if (same === undefined) throw new Error(`${source.title} no longer has the mention.`);
    try {
      await vault.write(from, linkMention(file.text, same, target), file.hash);
      return;
    } catch (error) {
      if (!(error instanceof ChangedOnDisk)) throw error;
    }
  }
}
