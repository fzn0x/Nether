// A web link alone on its line, `<https://…>`, shown as a card. The page's
// preview, its site, title and description, shows once fetched; it is
// fetched only when the user asks, and kept by the app, so a note that
// shows it later reaches no server. The link opens in the system's browser.
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useEffect, useState } from "react";
import type { EditorWords } from "./words.ts";

/** What a web page says of itself, as a link's preview shows it. */
export interface LinkPreview {
  readonly title?: string;
  readonly description?: string;
  readonly site?: string;
}

/** Previews of web links, which the app fetches when the user asks, and keeps. */
export interface LinkPreviews {
  /** The preview kept for an address, if one was fetched before. */
  get(url: string): LinkPreview | undefined;
  /** Fetches an address's preview, and keeps it. */
  fetch(url: string): Promise<LinkPreview>;
  /** Opens an address in the system's browser. */
  open(url: string): void;
  /** Calls `listener` when a preview is kept; returns a function that stops it. */
  subscribe?(listener: () => void): () => void;
}

export function BookmarkView(
  props: NodeViewProps & {
    readonly words: EditorWords;
    readonly previews: LinkPreviews | undefined;
  },
) {
  const { node, words, previews } = props;
  const url = typeof node.attrs.url === "string" ? node.attrs.url : "";
  const [preview, setPreview] = useState(() => previews?.get(url));
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setPreview(previews?.get(url));
    return previews?.subscribe?.(() => {
      setPreview(previews.get(url));
    });
  }, [previews, url]);

  const show = () => {
    if (previews === undefined) return;
    setFetching(true);
    setError(undefined);
    previews.fetch(url).then(
      (fetched) => {
        setPreview(fetched);
        setFetching(false);
      },
      (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setFetching(false);
      },
    );
  };

  const title = preview?.title !== undefined && preview.title !== "" ? preview.title : undefined;
  return (
    <NodeViewWrapper className="bookmark-card" contentEditable={false}>
      {preview?.site === undefined || preview.site === "" ? null : (
        <span className="bookmark-site">{preview.site}</span>
      )}
      {title === undefined ? null : <span className="bookmark-title">{title}</span>}
      {preview?.description === undefined || preview.description === "" ? null : (
        <span className="bookmark-description">{preview.description}</span>
      )}
      <span className="bookmark-url">{url}</span>
      {previews === undefined ? null : (
        <span className="bookmark-actions">
          {preview === undefined ? (
            <button type="button" className="quiet" disabled={fetching} onClick={show}>
              {fetching ? words.fetchingPreview : words.showPreview}
            </button>
          ) : null}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              previews.open(url);
            }}
          >
            {words.openLink}
          </button>
        </span>
      )}
      {error === undefined ? null : (
        <span className="bookmark-error" role="alert">
          {words.previewFailed}: {error}
        </span>
      )}
    </NodeViewWrapper>
  );
}
