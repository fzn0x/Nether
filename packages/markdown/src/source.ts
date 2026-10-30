// What a parse remembers about the file, so that writing the note back keeps
// the bytes of every block that did not change (ADR 0003).
import type { Block, BlockId, ContentBlock, PropertyEntry } from "@nether/core";

/** A top-level block of the file: where it stands and what it held. */
export interface SourceBlock {
  readonly id: BlockId;
  /** The block's content with its IDs left out, to tell whether it changed. */
  readonly fingerprint: string;
  /** Its bytes, from `start` up to `end`, in `Source.text`. */
  readonly start: number;
  readonly end: number;
  /** Whether those bytes write the block's ID as `^id`. */
  readonly idWritten: boolean;
}

/** The marker characters a file uses, so that rewritten blocks match it. */
export interface Style {
  readonly bullet: "-" | "*" | "+";
  readonly emphasis: "*" | "_";
  readonly strong: "*" | "_";
  readonly fence: "`" | "~";
  readonly rule: "-" | "*" | "_";
}

export const defaultStyle: Style = {
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fence: "`",
  rule: "-",
};

export interface SourceFrontmatter {
  /** The frontmatter's bytes, fences included, from `start` up to `end`. */
  readonly start: number;
  readonly end: number;
  /** The YAML between the fences. */
  readonly yaml: string;
  /** The properties it held, to tell whether they changed. */
  readonly properties: readonly PropertyEntry[];
  /** Why the YAML could not be read, when it could not. */
  readonly error?: string;
}

/** A file as it was read or last written. */
export interface Source {
  /** The file's text, without a byte order mark. */
  readonly text: string;
  readonly bom: boolean;
  /** The line ending the file uses, which new text follows. */
  readonly eol: "\n" | "\r\n";
  readonly style: Style;
  readonly frontmatter?: SourceFrontmatter;
  readonly blocks: readonly SourceBlock[];
}

function withoutIds(block: Block): unknown {
  const rest = Object.fromEntries(Object.entries(block).filter(([key]) => key !== "id"));
  if (!("children" in block)) return rest;
  return { ...rest, children: (block.children as readonly Block[]).map(withoutIds) };
}

function sortKeys(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A block's content as a string, without its own ID or those of its children. */
export function fingerprint(block: ContentBlock): string {
  return JSON.stringify(withoutIds(block), sortKeys);
}

/** Whether two values are the same JSON, whatever the order of their keys. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a, sortKeys) === JSON.stringify(b, sortKeys);
}
