// What a canvas's cards show (ADR 0051): a text card's Markdown, a note's
// title and opening, an image, a link's site and address, and a group's
// label. Markdown is drawn by the renderer exports use, which escapes the
// HTML a file holds and keeps only safe addresses; a click on a link opens
// the note it names, or the page outside the app.
import type { CanvasNode } from "@nether/canvas";
import { type LinkTarget, type NoteId, inlineContent } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import { type HtmlHooks, blocksToHtml, parseMarkdown } from "@nether/markdown";
import type { Vault } from "@nether/storage";
import { type MouseEvent, useEffect, useState } from "react";
import type { VaultMedia } from "./backend.ts";
import { t } from "./messages.ts";

const imageFile = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i;
/** How a link to a note is written in a card, for its click to open the note. */
const notePrefix = "#nether-note:";
/** How much of a note its card shows: its first blocks. */
const openingBlocks = 12;

export function isImagePath(path: string): boolean {
  return imageFile.test(path);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.(?:md|canvas)$/i, "");
}

/** The renderer's hooks for a card: links to notes resolved from `from`, files by the vault's media. */
function hooksFor(vault: Vault, graph: LinkGraph, media: VaultMedia, from: string): HtmlHooks {
  return {
    link: (target: LinkTarget) => {
      const id =
        "note" in target
          ? target.note
          : "title" in target
            ? graph.resolve(target.title, from)
            : undefined;
      return id === undefined ? undefined : `${notePrefix}${id}`;
    },
    file: (src: string) => {
      const path = vault.resolveFile(src, from);
      return path === undefined ? undefined : media.url(path);
    },
  };
}

/** Opens what a click in a card's Markdown points at: a note in the app, a page outside it. */
function onLinkClick(event: MouseEvent<HTMLElement>, onOpenNote: (id: NoteId) => void): void {
  const anchor = (event.target as Element).closest("a");
  if (anchor === null) return;
  const href = anchor.getAttribute("href") ?? "";
  event.preventDefault();
  event.stopPropagation();
  if (href.startsWith(notePrefix)) onOpenNote(href.slice(notePrefix.length) as NoteId);
  else if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener");
}

/** Markdown drawn as HTML, once the renderer gives it. */
function Markdown(props: {
  readonly text: string;
  readonly hooks: HtmlHooks;
  readonly limit?: number;
  /** A title the card shows already, which a first heading saying the same is left out for. */
  readonly title?: string;
  readonly className: string;
  readonly onOpenNote: (id: NoteId) => void;
}) {
  const { text, hooks, limit, title, className, onOpenNote } = props;
  const [html, setHtml] = useState<string | undefined>();
  useEffect(() => {
    let current = true;
    let blocks;
    try {
      blocks = parseMarkdown(text).content;
    } catch {
      setHtml(undefined);
      return;
    }
    const [first] = blocks;
    if (
      title !== undefined &&
      first?.type === "heading" &&
      inlineContent(first)
        .map((inline) => ("text" in inline ? inline.text : ""))
        .join("")
        .trim() === title
    ) {
      blocks = blocks.slice(1);
    }
    void blocksToHtml(limit === undefined ? blocks : blocks.slice(0, limit), hooks).then((made) => {
      if (current) setHtml(made);
    });
    return () => {
      current = false;
    };
  }, [text, hooks, limit, title]);
  return html === undefined ? (
    <div className={className}>{text}</div>
  ) : (
    <div
      className={`${className} canvas-markdown`}
      // The renderer escapes what the text holds and keeps only safe addresses.
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        onLinkClick(event, onOpenNote);
      }}
    />
  );
}

/** A note's card: its title, which opens it, and its opening, kept current as it changes. */
function NoteCard(props: {
  readonly id: NoteId;
  readonly vault: Vault;
  readonly hooks: HtmlHooks;
  readonly subpath: string | undefined;
  readonly onOpenNote: (id: NoteId) => void;
}) {
  const { id, vault, hooks, subpath, onOpenNote } = props;
  const [text, setText] = useState<string | undefined>();
  useEffect(() => {
    let current = true;
    const read = () => {
      void vault.read(id).then(
        (file) => {
          if (current) setText(file.missing === true || file.binary === true ? "" : file.text);
        },
        () => undefined,
      );
    };
    read();
    const stop = vault.subscribe((changed) => {
      if (changed.includes(id)) read();
    });
    return () => {
      current = false;
      stop();
    };
  }, [vault, id]);
  const title = vault.note(id)?.title ?? "";
  return (
    <>
      <button
        type="button"
        className="canvas-note"
        tabIndex={-1}
        onClick={() => {
          onOpenNote(id);
        }}
      >
        {title}
        {subpath === undefined ? null : <span className="canvas-subpath">{subpath}</span>}
      </button>
      {text === undefined ? null : (
        <Markdown
          text={text}
          hooks={hooks}
          limit={openingBlocks}
          title={title}
          className="canvas-note-body"
          onOpenNote={onOpenNote}
        />
      )}
    </>
  );
}

/** What a card shows, by its kind. */
export function CardBody(props: {
  readonly node: CanvasNode;
  readonly vault: Vault;
  readonly graph: LinkGraph;
  readonly media: VaultMedia;
  /** The canvas's path, which links in its cards are read from. */
  readonly from: string;
  readonly onOpenNote: (id: NoteId) => void;
}) {
  const { node, vault, graph, media, from, onOpenNote } = props;
  const [hooks] = useState(() => hooksFor(vault, graph, media, from));
  if (node.type === "text") {
    return (
      <Markdown text={node.text} hooks={hooks} className="canvas-text" onOpenNote={onOpenNote} />
    );
  }
  if (node.type === "group") return null;
  if (node.type === "link") {
    let host = node.url;
    try {
      host = new URL(node.url).host;
    } catch {
      // Not an address a URL reads: shown as it is.
    }
    return (
      <a
        className="canvas-link"
        href={node.url}
        tabIndex={-1}
        onClick={(event) => {
          event.preventDefault();
          if (/^https?:/i.test(node.url)) window.open(node.url, "_blank", "noopener");
        }}
      >
        <span className="canvas-link-host">{host}</span>
        <span className="canvas-link-url">{node.url}</span>
      </a>
    );
  }
  if (isImagePath(node.file)) {
    const url = media.url(node.file);
    return url === undefined ? (
      <p className="canvas-missing">{t("canvasFileMissing", { name: node.file })}</p>
    ) : (
      <img className="canvas-image" src={url} alt={nameOf(node.file)} draggable={false} />
    );
  }
  const note = vault.noteAt(node.file);
  if (note === undefined) {
    return <p className="canvas-missing">{t("canvasFileMissing", { name: node.file })}</p>;
  }
  return (
    <NoteCard
      id={note.id}
      vault={vault}
      hooks={hooks}
      subpath={node.subpath}
      onOpenNote={onOpenNote}
    />
  );
}
