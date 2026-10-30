// micromark extensions for Obsidian's syntax, and the mdast-util-from-markdown
// extension that turns their tokens into syntax tree nodes. Each construct
// follows what Obsidian accepts, so a file means the same in both apps.
import type { InlineMath } from "mdast-util-math";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Token as CompileToken,
} from "mdast-util-from-markdown";
import { classifyCharacter } from "micromark-util-classify-character";
import { splice } from "micromark-util-chunked";
import {
  asciiDigit,
  markdownLineEnding,
  markdownLineEndingOrSpace,
  markdownSpace,
  unicodeWhitespace,
} from "micromark-util-character";
import { resolveAll } from "micromark-util-resolve-all";
import { codes, constants, types } from "micromark-util-symbol";
import type {
  Code,
  Construct,
  Effects,
  Event,
  Extension,
  State,
  Token,
  TokenizeContext,
} from "micromark-util-types";
import type {
  CommentBlockNode,
  CommentNode,
  HighlightNode,
  RawInlineNode,
  TagNode,
  WikiLinkNode,
} from "./mdast.ts";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    wikiLink: "wikiLink";
    wikiLinkMarker: "wikiLinkMarker";
    wikiLinkData: "wikiLinkData";
    tag: "tag";
    tagMarker: "tagMarker";
    tagName: "tagName";
    highlight: "highlight";
    highlightSequence: "highlightSequence";
    highlightSequenceTemporary: "highlightSequenceTemporary";
    highlightText: "highlightText";
    obsidianComment: "obsidianComment";
    obsidianCommentMarker: "obsidianCommentMarker";
    obsidianCommentData: "obsidianCommentData";
    obsidianMath: "obsidianMath";
    obsidianMathSequence: "obsidianMathSequence";
    obsidianMathData: "obsidianMathData";
    commentBlock: "commentBlock";
    commentBlockFence: "commentBlockFence";
    commentBlockValue: "commentBlockValue";
  }
}

// Wiki links and embeds: `[[target]]`, `[[target|alias]]`, `![[target]]`.
// The target runs to `]]` on the same line and holds no `[`.

function wikiTokenizer(embed: boolean) {
  return function tokenize(effects: Effects, ok: State, nok: State): State {
    let size = 0;

    const open = (code: Code): State | undefined => {
      if (code !== codes.leftSquareBracket) return nok(code);
      effects.consume(code);
      return openSecond;
    };
    const openSecond = (code: Code): State | undefined => {
      if (code !== codes.leftSquareBracket) return nok(code);
      effects.consume(code);
      effects.exit("wikiLinkMarker");
      effects.enter("wikiLinkData");
      return data;
    };
    const data = (code: Code): State | undefined => {
      if (code === codes.eof || markdownLineEnding(code) || code === codes.leftSquareBracket) {
        return nok(code);
      }
      if (code === codes.rightSquareBracket) {
        if (size === 0) return nok(code);
        effects.exit("wikiLinkData");
        effects.enter("wikiLinkMarker");
        effects.consume(code);
        return close;
      }
      effects.consume(code);
      size++;
      return data;
    };
    const close = (code: Code): State | undefined => {
      if (code !== codes.rightSquareBracket) return nok(code);
      effects.consume(code);
      effects.exit("wikiLinkMarker");
      effects.exit("wikiLink");
      return ok;
    };

    return (code: Code): State | undefined => {
      effects.enter("wikiLink");
      effects.enter("wikiLinkMarker");
      if (!embed) return open(code);
      effects.consume(code);
      return open;
    };
  };
}

const wikiLink: Construct = { name: "wikiLink", tokenize: wikiTokenizer(false) };
const wikiEmbed: Construct = { name: "wikiEmbed", tokenize: wikiTokenizer(true) };

// Tags: `#name` at the start of a line or after white space. A name is
// letters, digits, combining marks, `_`, `-` and `/`, and is not only
// digits; anything else, an emoji included, ends it. The core model's
// `isTagName` checks the same characters.

function isTagCharacter(code: Code): boolean {
  if (code === null || code < 0) return false;
  if (code === codes.underscore || code === codes.dash || code === codes.slash) return true;
  return /^[\p{L}\p{N}\p{M}]$/u.test(String.fromCharCode(code));
}

function previousTag(this: TokenizeContext, code: Code): boolean {
  return code === codes.eof || markdownLineEndingOrSpace(code) || unicodeWhitespace(code);
}

const tag: Construct = {
  name: "tag",
  previous: previousTag,
  tokenize(effects, ok, nok) {
    let size = 0;
    let digitsOnly = true;
    const name = (code: Code): State | undefined => {
      if (isTagCharacter(code)) {
        if (!asciiDigit(code)) digitsOnly = false;
        effects.consume(code);
        size++;
        return name;
      }
      if (size === 0 || digitsOnly) return nok(code);
      effects.exit("tagName");
      effects.exit("tag");
      return ok(code);
    };
    return (code: Code): State | undefined => {
      effects.enter("tag");
      effects.enter("tagMarker");
      effects.consume(code);
      effects.exit("tagMarker");
      effects.enter("tagName");
      return name;
    };
  },
};

// Highlights: `==text==`, resolved like GFM's strikethrough: a sequence of
// exactly two `=` opens or closes by the same flanking rules as emphasis.

const highlight: Construct = {
  name: "highlight",
  tokenize(effects, ok, nok) {
    const previous = this.previous;
    const events = this.events;
    let size = 0;
    const more = (code: Code): State | undefined => {
      const before = classifyCharacter(previous);
      if (code === codes.equalsTo) {
        if (size > 1) return nok(code);
        effects.consume(code);
        size++;
        return more;
      }
      if (size < 2) return nok(code);
      const token = effects.exit("highlightSequenceTemporary");
      const after = classifyCharacter(code);
      token._open = !after || (after === constants.attentionSideAfter && Boolean(before));
      token._close = !before || (before === constants.attentionSideAfter && Boolean(after));
      return ok(code);
    };
    return (code: Code): State | undefined => {
      const tail = events[events.length - 1];
      if (previous === codes.equalsTo && tail?.[1].type !== types.characterEscape) return nok(code);
      effects.enter("highlightSequenceTemporary");
      return more(code);
    };
  },
  resolveAll(events, context) {
    let index = -1;
    while (++index < events.length) {
      const closer = events[index];
      if (
        closer?.[0] !== "enter" ||
        closer[1].type !== "highlightSequenceTemporary" ||
        closer[1]._close !== true
      ) {
        continue;
      }
      let open = index;
      while (open--) {
        const opener = events[open];
        if (
          opener?.[0] === "exit" &&
          opener[1].type === "highlightSequenceTemporary" &&
          opener[1]._open === true
        ) {
          closer[1].type = "highlightSequence";
          opener[1].type = "highlightSequence";
          const whole: Token = {
            type: "highlight",
            start: { ...opener[1].start },
            end: { ...closer[1].end },
          };
          const text: Token = {
            type: "highlightText",
            start: { ...opener[1].end },
            end: { ...closer[1].start },
          };
          const next: Event[] = [
            ["enter", whole, context],
            ["enter", opener[1], context],
            ["exit", opener[1], context],
            ["enter", text, context],
          ];
          const insideSpan = context.parser.constructs.insideSpan.null;
          if (insideSpan) {
            splice(
              next,
              next.length,
              0,
              resolveAll(insideSpan, events.slice(open + 1, index), context),
            );
          }
          splice(next, next.length, 0, [
            ["exit", text, context],
            ["enter", closer[1], context],
            ["exit", closer[1], context],
            ["exit", whole, context],
          ]);
          splice(events, open - 1, index - open + 3, next);
          index = open + next.length - 2;
          break;
        }
      }
    }
    for (const event of events) {
      if (event[1].type === "highlightSequenceTemporary") event[1].type = types.data;
    }
    return events;
  },
};

// Inline comments: `%%text%%`, within a paragraph. What stands between the
// markers is not Markdown.

const comment: Construct = {
  name: "obsidianComment",
  tokenize(effects, ok, nok) {
    let size = 0;
    let sequence: Token | undefined;
    const between = (code: Code): State | undefined => {
      if (code === codes.eof) return nok(code);
      if (code === codes.percentSign) {
        sequence = effects.enter("obsidianCommentMarker");
        size = 0;
        return sequenceClose(code);
      }
      if (markdownLineEnding(code)) {
        effects.enter(types.lineEnding);
        effects.consume(code);
        effects.exit(types.lineEnding);
        return between;
      }
      effects.enter("obsidianCommentData");
      return data(code);
    };
    const data = (code: Code): State | undefined => {
      if (code === codes.eof || code === codes.percentSign || markdownLineEnding(code)) {
        effects.exit("obsidianCommentData");
        return between(code);
      }
      effects.consume(code);
      return data;
    };
    const sequenceClose = (code: Code): State | undefined => {
      if (code === codes.percentSign) {
        effects.consume(code);
        size++;
        return sequenceClose;
      }
      if (size === 2) {
        effects.exit("obsidianCommentMarker");
        effects.exit("obsidianComment");
        return ok(code);
      }
      if (sequence) sequence.type = "obsidianCommentData";
      return data(code);
    };
    const openSecond = (code: Code): State | undefined => {
      if (code !== codes.percentSign) return nok(code);
      effects.consume(code);
      effects.exit("obsidianCommentMarker");
      return between;
    };
    return (code: Code): State | undefined => {
      effects.enter("obsidianComment");
      effects.enter("obsidianCommentMarker");
      effects.consume(code);
      return openSecond;
    };
  },
};

// Inline math as Obsidian reads it: `$` opens when the next character is
// not white space, and closes when the one before is not white space and
// the next is not a digit, so `$5 and $10` stays text. `$$x$$` within a
// line is display math. `\$` inside does not close.

const math: Construct = {
  name: "obsidianMath",
  previous(code) {
    // Not right after a dollar, unless that one was escaped: `\$$x$` is a dollar and math.
    return code !== codes.dollarSign || this.events.at(-1)?.[1].type === types.characterEscape;
  },
  tokenize(effects, ok, nok) {
    let sizeOpen = 0;
    let size = 0;
    let last: Code = codes.eof;
    let sequence: Token | undefined;

    const between = (code: Code): State | undefined => {
      if (code === codes.eof) return nok(code);
      if (code === codes.dollarSign) {
        if (sizeOpen === 1 && markdownLineEndingOrSpace(last)) {
          effects.enter("obsidianMathData");
          effects.consume(code);
          last = code;
          return data;
        }
        sequence = effects.enter("obsidianMathSequence");
        size = 0;
        return sequenceClose(code);
      }
      if (markdownLineEnding(code)) {
        effects.enter(types.lineEnding);
        effects.consume(code);
        effects.exit(types.lineEnding);
        last = code;
        return between;
      }
      effects.enter("obsidianMathData");
      return data(code);
    };
    const data = (code: Code): State | undefined => {
      if (code === codes.eof || code === codes.dollarSign || markdownLineEnding(code)) {
        effects.exit("obsidianMathData");
        return between(code);
      }
      effects.consume(code);
      last = code;
      return code === codes.backslash ? escaped : data;
    };
    const escaped = (code: Code): State | undefined => {
      if (code !== codes.dollarSign && code !== codes.backslash) return data(code);
      effects.consume(code);
      last = code;
      return data;
    };
    const sequenceClose = (code: Code): State | undefined => {
      if (code === codes.dollarSign) {
        effects.consume(code);
        size++;
        return sequenceClose;
      }
      if (size === sizeOpen && !(sizeOpen === 1 && asciiDigit(code))) {
        effects.exit("obsidianMathSequence");
        effects.exit("obsidianMath");
        return ok(code);
      }
      if (sequence) sequence.type = "obsidianMathData";
      last = codes.dollarSign;
      return data(code);
    };
    const sequenceOpen = (code: Code): State | undefined => {
      if (code === codes.dollarSign) {
        if (sizeOpen === 2) return nok(code);
        effects.consume(code);
        sizeOpen++;
        return sequenceOpen;
      }
      if (code === codes.eof || (sizeOpen === 1 && markdownLineEndingOrSpace(code))) {
        return nok(code);
      }
      effects.exit("obsidianMathSequence");
      return between(code);
    };
    return (code: Code): State | undefined => {
      effects.enter("obsidianMath");
      effects.enter("obsidianMathSequence");
      return sequenceOpen(code);
    };
  },
};

// Comments over several lines, blank lines included: a line of only `%%`
// opens one, and the next line that holds `%%` closes it. Like a code fence
// left open, a comment never closed runs to the end of its container. A
// `%%` with text on its line starts an inline comment instead.

const nonLazyContinuation: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    const lineStart = (code: Code): State | undefined =>
      this.parser.lazy[this.now().line] === true ? nok(code) : ok(code);
    return (code: Code): State | undefined => {
      if (code === codes.eof) return nok(code);
      effects.enter(types.lineEnding);
      effects.consume(code);
      effects.exit(types.lineEnding);
      return lineStart;
    };
  },
};

const commentBlock: Construct = {
  name: "commentBlock",
  concrete: true,
  tokenize(effects, ok, nok) {
    const closeStart: Construct = {
      partial: true,
      tokenize(effects, ok, nok) {
        let last: Code = codes.eof;
        let closed = false;
        const line = (code: Code): State | undefined => {
          if (code === codes.eof || markdownLineEnding(code)) {
            if (!closed) return nok(code);
            effects.exit("commentBlockFence");
            return ok(code);
          }
          if (code === codes.percentSign && last === codes.percentSign) closed = true;
          last = code;
          effects.consume(code);
          return line;
        };
        return (code: Code): State | undefined => {
          effects.enter(types.lineEnding);
          effects.consume(code);
          effects.exit(types.lineEnding);
          effects.enter("commentBlockFence");
          return line;
        };
      },
    };

    let size = 0;
    const done = (code: Code): State | undefined => {
      effects.exit("commentBlock");
      return ok(code);
    };
    const contentLine = (code: Code): State | undefined => {
      if (code === codes.eof || markdownLineEnding(code)) {
        effects.exit("commentBlockValue");
        return contentBreak(code);
      }
      effects.consume(code);
      return contentLine;
    };
    const contentStart = (code: Code): State | undefined => {
      if (code === codes.eof || markdownLineEnding(code)) return contentBreak(code);
      effects.enter("commentBlockValue");
      return contentLine(code);
    };
    const contentBefore = (code: Code): State | undefined => {
      effects.enter(types.lineEnding);
      effects.consume(code);
      effects.exit(types.lineEnding);
      return contentStart;
    };
    const atBreak = (code: Code): State | undefined =>
      effects.attempt(closeStart, done, contentBefore)(code);
    function contentBreak(code: Code): State | undefined {
      return effects.check(nonLazyContinuation, atBreak, done)(code);
    }
    const openRest = (code: Code): State | undefined => {
      if (code === codes.eof || markdownLineEnding(code)) {
        effects.exit("commentBlockFence");
        return contentBreak(code);
      }
      if (!markdownSpace(code)) return nok(code);
      effects.consume(code);
      return openRest;
    };
    const sequenceOpen = (code: Code): State | undefined => {
      if (code === codes.percentSign && size < 2) {
        effects.consume(code);
        size++;
        return sequenceOpen;
      }
      if (size < 2 || code === codes.percentSign) return nok(code);
      return openRest(code);
    };
    return (code: Code): State | undefined => {
      // Right after a paragraph's line, `%%` closes or continues that paragraph's comment.
      if (this.interrupt) return nok(code);
      effects.enter("commentBlock");
      effects.enter("commentBlockFence");
      return sequenceOpen(code);
    };
  },
};

/** The micromark syntax extension for Obsidian's syntax. */
export function obsidianSyntax(): Extension {
  return {
    flow: { [codes.percentSign]: commentBlock },
    text: {
      [codes.leftSquareBracket]: wikiLink,
      [codes.exclamationMark]: wikiEmbed,
      [codes.numberSign]: tag,
      [codes.equalsTo]: highlight,
      [codes.percentSign]: comment,
      [codes.dollarSign]: math,
    },
    insideSpan: { null: [highlight] },
    attentionMarkers: { null: [codes.equalsTo] },
  };
}

/** In a GFM table cell, `\|` is a pipe, in math and comments as in code. */
function unpipe(context: CompileContext, value: string): string {
  return context.data.inTable === true ? value.replace(/\\\|/g, "|") : value;
}

/** The mdast-util-from-markdown extension that builds nodes from those tokens. */
export function obsidianFromMarkdown(): FromMarkdownExtension {
  function exit(this: CompileContext, token: CompileToken): undefined {
    this.exit(token);
  }
  return {
    canContainEols: ["highlight"],
    enter: {
      wikiLink(token) {
        const source = this.sliceSerialize(token);
        const embed = source.startsWith("!");
        const node: WikiLinkNode = {
          type: "wikiLink",
          embed,
          value: source.slice(embed ? 3 : 2, -2),
        };
        this.enter(node, token);
      },
      tag(token) {
        const node: TagNode = { type: "tag", value: this.sliceSerialize(token).slice(1) };
        this.enter(node, token);
      },
      highlight(token) {
        const node: HighlightNode = { type: "highlight", children: [] };
        this.enter(node, token);
      },
      obsidianComment(token) {
        const node: CommentNode = {
          type: "obsidianComment",
          value: unpipe(this, this.sliceSerialize(token).slice(2, -2)),
        };
        this.enter(node, token);
      },
      obsidianMath(token) {
        const source = unpipe(this, this.sliceSerialize(token));
        // Display math within a line has no inline form in Nether: it stays as written.
        if (source.startsWith("$$")) {
          const node: RawInlineNode = { type: "rawInline", value: source };
          this.enter(node, token);
        } else {
          const node: InlineMath = { type: "inlineMath", value: source.slice(1, -1) };
          this.enter(node, token);
        }
      },
      commentBlock(token) {
        const node: CommentBlockNode = { type: "commentBlock", value: this.sliceSerialize(token) };
        this.enter(node, token);
      },
    },
    exit: {
      wikiLink: exit,
      tag: exit,
      highlight: exit,
      obsidianComment: exit,
      obsidianMath: exit,
      commentBlock: exit,
    },
  };
}
