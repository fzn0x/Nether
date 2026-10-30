// Reads notes for the link index away from the page's main thread, so a
// large vault's first index never holds up typing: the page sends notes'
// text in batches and gets back what the index keeps of each.
import { type NoteIndex, indexNote } from "@nether/graph";
import { parseMarkdown } from "@nether/markdown";

export interface IndexRequest {
  readonly batch: number;
  readonly notes: readonly { readonly id: string; readonly text: string }[];
}

export interface IndexResponse {
  readonly batch: number;
  readonly results: readonly { readonly id: string; readonly index: NoteIndex }[];
}

const empty: NoteIndex = { links: [], tags: [], aliases: [], headings: [], blocks: [] };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<IndexRequest>) => void) | null;
  postMessage(message: IndexResponse): void;
};

scope.onmessage = (event) => {
  const { batch, notes } = event.data;
  const results = notes.map(({ id, text }) => {
    try {
      const parsed = parseMarkdown(text);
      return { id, index: indexNote(parsed, parsed.writtenIds) };
    } catch {
      // A note the parser cannot read links nowhere, rather than stopping the index.
      return { id, index: empty };
    }
  });
  scope.postMessage({ batch, results });
};
