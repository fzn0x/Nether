// Links between notes, as the link index and the backlinks panel see them.
import { type LinkTarget, inlineContent, walkBlocks } from "./blocks.ts";
import type { DatabaseSchema } from "./databases.ts";
import type { BlockId, NoteId } from "./ids.ts";
import type { Note } from "./notes.ts";

export interface Link {
  /** The note the link is in, and the block when it is in one. */
  readonly source: { readonly note: NoteId; readonly block?: BlockId };
  readonly target: LinkTarget;
  /** A wiki link in text, an embedded note or block, or a relation property. */
  readonly kind: "wiki" | "embed" | "relation";
}

/**
 * The links going out of a note, in document order: wiki links in its text,
 * the notes and blocks it embeds, and, given its database's schema, the rows
 * its relation properties point to.
 */
export function extractLinks(note: Note, schema?: DatabaseSchema): Link[] {
  const links: Link[] = [];
  for (const block of walkBlocks(note.content)) {
    const source = { note: note.id, block: block.id };
    if (block.type === "embed") links.push({ source, target: block.attrs.target, kind: "embed" });
    for (const inline of inlineContent(block)) {
      if (inline.type === "wikiLink") links.push({ source, target: inline.target, kind: "wiki" });
    }
  }
  for (const definition of schema?.properties ?? []) {
    if (definition.type !== "relation") continue;
    const value = note.properties.find((entry) => entry.key === definition.key)?.value;
    if (!Array.isArray(value)) continue;
    for (const target of value) {
      if (typeof target === "string") {
        links.push({
          source: { note: note.id },
          target: { note: target as NoteId },
          kind: "relation",
        });
      }
    }
  }
  return links;
}
