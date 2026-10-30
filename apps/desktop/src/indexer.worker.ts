// Reads notes for the link index and search away from the page's main
// thread, so a large vault's first index never holds up typing: the page
// sends notes' Markdown in batches and gets back what the link index keeps
// of each, and its text for search.
import { type NoteIndex, indexNote, plainText } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";

export interface IndexRequest {
  readonly batch: number;
  readonly notes: readonly { readonly id: string; readonly text: string }[];
}

export interface IndexResponse {
  readonly batch: number;
  readonly results: readonly {
    readonly id: string;
    readonly index: NoteIndex;
    /** The note's text, as search reads it. */
    readonly text: string;
  }[];
}

const empty: NoteIndex = {
  links: [],
  tags: [],
  aliases: [],
  headings: [],
  blocks: [],
  properties: [],
};

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<IndexRequest>) => void) | null;
  postMessage(message: IndexResponse): void;
};

scope.onmessage = (event) => {
  const { batch, notes } = event.data;
  const results = notes.map(({ id, text }) => {
    try {
      const parsed = parseMarkdown(text);
      return { id, index: indexNote(parsed, parsed.writtenIds), text: plainText(parsed.content) };
    } catch {
      // A note the parser cannot read links nowhere, and is searched as written.
      return { id, index: empty, text };
    }
  });
  scope.postMessage({ batch, results });
};
