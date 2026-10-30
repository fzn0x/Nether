// The syntax tree nodes Nether adds to mdast for Obsidian's syntax and for
// Markdown it keeps byte for byte.
import type { Literal, Parent, PhrasingContent } from "mdast";

/** `[[target|alias]]`, or `![[target]]` when `embed` is set; `value` is what stands between the brackets. */
export interface WikiLinkNode extends Literal {
  type: "wikiLink";
  embed: boolean;
}

/** `#name`; `value` is the name without its `#`. */
export interface TagNode extends Literal {
  type: "tag";
}

/** `==text==`. */
export interface HighlightNode extends Parent {
  type: "highlight";
  children: PhrasingContent[];
}

/** `<u>text</u>`. */
export interface UnderlineNode extends Parent {
  type: "underline";
  children: PhrasingContent[];
}

/** `%%text%%`, a comment Obsidian hides; `value` is the text between the markers. */
export interface CommentNode extends Literal {
  type: "obsidianComment";
}

/** Inline Markdown written as is: `value` is the exact source. */
export interface RawInlineNode extends Literal {
  type: "rawInline";
}

/** A `%%` comment over several lines. */
export interface CommentBlockNode extends Literal {
  type: "commentBlock";
}

/** Block Markdown written as is: `value` is the exact source. */
export interface RawBlockNode extends Literal {
  type: "rawBlock";
}

declare module "mdast" {
  interface PhrasingContentMap {
    wikiLink: WikiLinkNode;
    tag: TagNode;
    highlight: HighlightNode;
    underline: UnderlineNode;
    obsidianComment: CommentNode;
    rawInline: RawInlineNode;
  }
  interface BlockContentMap {
    commentBlock: CommentBlockNode;
    rawBlock: RawBlockNode;
  }
  interface RootContentMap {
    wikiLink: WikiLinkNode;
    tag: TagNode;
    highlight: HighlightNode;
    underline: UnderlineNode;
    obsidianComment: CommentNode;
    rawInline: RawInlineNode;
    commentBlock: CommentBlockNode;
    rawBlock: RawBlockNode;
  }
}
