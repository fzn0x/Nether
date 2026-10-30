// Parts of a note the editor can go to: a heading by its text, or a block
// by its ID, and a place in that block's text.
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** A heading or block to go to, and how far into its text. */
export interface NotePart {
  readonly heading?: string;
  readonly block?: string;
  /** Characters into the block's text, each inline that is not text, as a link, counting one. */
  readonly offset?: number;
}

/** The position `offset` into a node's text, or into that of the first block in it with text. */
function textPosition(node: ProseMirrorNode, position: number, offset: number): number {
  if (node.isTextblock) return position + 1 + Math.min(offset, node.content.size);
  let found: number | undefined;
  node.descendants((child, childPosition) => {
    if (found !== undefined) return false;
    if (!child.isTextblock) return true;
    found = position + 1 + childPosition + 1 + Math.min(offset, child.content.size);
    return false;
  });
  return found ?? position + 1;
}

/** Where in a note a heading, case and spaces aside, or a block by its ID, has its text, and the offset into it. */
export function findPart(doc: ProseMirrorNode, part: NotePart): number | undefined {
  const heading = part.heading?.trim().replace(/\s+/g, " ").toLowerCase();
  let found: number | undefined;
  doc.descendants((node, position) => {
    if (found !== undefined) return false;
    const byBlock = part.block !== undefined && node.attrs.id === part.block;
    const byHeading =
      heading !== undefined &&
      node.type.name === "heading" &&
      node.textContent.trim().replace(/\s+/g, " ").toLowerCase() === heading;
    if (byBlock || byHeading) found = textPosition(node, position, part.offset ?? 0);
    return true;
  });
  return found;
}
