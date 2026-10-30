// Files in a note: images, PDFs, audio and video, whether written as an
// image `![](photo.png)`, a file block, or an embed `![[photo.png]]`. The
// app finds the file a link names and gives the URL it loads from; links
// to web pages load as they are.
import { NodeSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { type ChangeEvent, type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import {
  type FileKind,
  type NoteFiles,
  embedSize,
  fileKind,
  fileUrl,
  isNoteLink,
  isWebLink,
  markdownPath,
} from "./files.ts";
import type { EditorWords } from "./words.ts";

interface FileProps {
  readonly link: string;
  readonly url: string | undefined;
  readonly kind: FileKind;
  readonly name: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly words: EditorWords;
  readonly files: NoteFiles | undefined;
}

/** A file the vault does not have, or one the page cannot show, by its link. */
function Missing(props: { readonly link: string; readonly label: string }) {
  return (
    <p className="missing-file" role="note">
      {props.label}: <span className="missing-link">{props.link}</span>
    </p>
  );
}

function FileActions(props: {
  readonly link: string;
  readonly kind: FileKind;
  readonly words: EditorWords;
  readonly files: NoteFiles | undefined;
}) {
  const { link, kind, words, files } = props;
  const local = !isWebLink(link);
  const buttons: ReactNode[] = [];
  if (local && kind !== "file" && files?.open !== undefined) {
    const open = files.open.bind(files);
    buttons.push(
      <button
        key="open"
        type="button"
        onClick={() => {
          open(link);
        }}
      >
        {words.openFile}
      </button>,
    );
  }
  if (local && files?.reveal !== undefined) {
    const reveal = files.reveal.bind(files);
    buttons.push(
      <button
        key="reveal"
        type="button"
        onClick={() => {
          reveal(link);
        }}
      >
        {words.revealFile}
      </button>,
    );
  }
  return buttons.length === 0 ? null : <span className="file-actions">{buttons}</span>;
}

/** A file shown as what it is: an image, a PDF, a player, or a card. */
function FileContent(props: FileProps) {
  const { link, url, kind, name, alt, width, height, words, files } = props;
  const [broken, setBroken] = useState(false);
  if (url === undefined) return <Missing link={link} label={words.missingFile} />;
  if (broken) return <Missing link={link} label={words.brokenFile} />;
  const failed = () => {
    setBroken(true);
  };
  switch (kind) {
    case "image":
      return (
        <img
          className="image"
          src={url}
          alt={alt ?? ""}
          width={width}
          height={height}
          onError={failed}
        />
      );
    case "audio":
      return (
        <audio
          className="file-audio"
          src={url}
          controls
          preload="metadata"
          aria-label={name}
          onError={failed}
        />
      );
    case "video":
      return (
        <video
          className="file-video"
          src={url}
          controls
          preload="metadata"
          aria-label={name}
          width={width}
          height={height}
          onError={failed}
        />
      );
    case "pdf":
      // The webview's own viewer shows PDFs where it has one; WebKitGTK has none.
      return navigator.pdfViewerEnabled ? (
        <iframe className="file-pdf" src={url} title={name} />
      ) : (
        <p className="file-card">
          <span className="file-name">{name}</span>
          <FileActions link={link} kind={kind} words={words} files={files} />
        </p>
      );
    case "file":
      return (
        <p className="file-card">
          <span className="file-name">{name}</span>
          <FileActions link={link} kind={kind} words={words} files={files} />
        </p>
      );
  }
}

/**
 * Back in the note from a field of a block's view, with the block
 * selected. Focused now: TipTap's focus command waits a frame, and keys
 * typed within it would go nowhere.
 */
export function backToNote(props: NodeViewProps) {
  const pos = props.getPos();
  if (pos === undefined) return;
  const { view, state } = props.editor;
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  view.focus();
}

/** A field for the link of an image or file block that has none yet, and a button to pick one. */
function Choose(
  props: NodeViewProps & {
    readonly words: EditorWords;
    readonly files: NoteFiles | undefined;
    readonly accept?: string;
  },
) {
  const { words, files, accept } = props;
  const replace = (link: string) => {
    const pos = props.getPos();
    if (pos === undefined) return;
    // A file added from disk is embedded as Obsidian embeds files.
    props.editor
      .chain()
      .focus()
      .insertContentAt(
        { from: pos, to: pos + props.node.nodeSize },
        { type: "embed", attrs: { target: { title: link } } },
      )
      .run();
  };
  const attach = files?.attach?.bind(files);
  const picker = useRef<HTMLInputElement>(null);
  return (
    <span className="file-choose">
      <input
        className="file-link"
        aria-label={words.fileLink}
        placeholder={words.fileLink}
        spellCheck={false}
        // A block without a file opens for one, as it does when the slash menu makes it.
        autoFocus
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Escape") {
            event.preventDefault();
            backToNote(props);
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          const link = event.currentTarget.value.trim();
          if (link === "") return;
          props.updateAttributes({ src: link });
          backToNote(props);
        }}
      />
      {attach === undefined ? null : (
        <>
          <button
            type="button"
            className="file-pick"
            onClick={() => {
              picker.current?.click();
            }}
          >
            {words.chooseFile}
          </button>
          <input
            ref={picker}
            type="file"
            hidden
            accept={accept}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              if (file === undefined) return;
              void attach(file, false).then((link) => {
                if (link !== undefined) replace(link);
              });
            }}
          />
        </>
      )}
    </span>
  );
}

interface ViewProps extends NodeViewProps {
  readonly words: EditorWords;
  readonly files: NoteFiles | undefined;
}

/** An image block, `![alt|300](photo.png "title")`. */
export function ImageView(props: ViewProps) {
  const { node, editor, words, files } = props;
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  if (src === "" && editor.isEditable) {
    return (
      <NodeViewWrapper className="file-block">
        <Choose {...props} accept="image/*" />
      </NodeViewWrapper>
    );
  }
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : undefined;
  const width = typeof node.attrs.width === "number" ? node.attrs.width : undefined;
  return (
    <NodeViewWrapper className="file-block image-block">
      <FileContent
        link={src}
        url={fileUrl(files, src, true)}
        kind="image"
        name={alt ?? src}
        {...(alt === undefined ? {} : { alt })}
        {...(width === undefined ? {} : { width })}
        words={words}
        files={files}
      />
    </NodeViewWrapper>
  );
}

/** A file block: a PDF, audio or video written as `![name](file.pdf)`. */
export function FileView(props: ViewProps) {
  const { node, editor, words, files } = props;
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  if (src === "" && editor.isEditable) {
    return (
      <NodeViewWrapper className="file-block">
        <Choose {...props} />
      </NodeViewWrapper>
    );
  }
  const name = typeof node.attrs.name === "string" ? node.attrs.name : markdownPath(src);
  return (
    <NodeViewWrapper className="file-block">
      <FileContent
        link={src}
        url={fileUrl(files, src, true)}
        kind={fileKind(src)}
        name={name}
        words={words}
        files={files}
      />
    </NodeViewWrapper>
  );
}

function targetLink(target: unknown): string {
  if (typeof target !== "object" || target === null) return "";
  const { title, heading, block } = target as {
    title?: unknown;
    heading?: unknown;
    block?: unknown;
  };
  let link = typeof title === "string" ? title : "";
  if (typeof heading === "string") link += `#${heading}`;
  if (typeof block === "string") link += `#^${block}`;
  return link;
}

/**
 * An embed, `![[photo.png|300]]`: a file shown as what it is. A note or a
 * part of one shows as a card until notes can be embedded.
 */
export function EmbedView(props: ViewProps) {
  const { node, words, files } = props;
  const link = targetLink(node.attrs.target);
  const alias = typeof node.attrs.alias === "string" ? node.attrs.alias : undefined;
  const title = link.split("#")[0] ?? link;
  if (title === "" || isNoteLink(title)) {
    return (
      <NodeViewWrapper className="file-block embed-note">
        <p className="file-card">
          <span className="file-name">
            {words.embeddedNote}: {alias ?? link}
          </span>
        </p>
      </NodeViewWrapper>
    );
  }
  const kind = fileKind(title);
  const size = embedSize(alias);
  const name = alias !== undefined && size.width === undefined ? alias : title;
  return (
    <NodeViewWrapper className={`file-block ${kind === "image" ? "image-block" : ""}`}>
      <FileContent
        link={title}
        url={fileUrl(files, title, false)}
        kind={kind}
        name={name}
        {...(kind === "image"
          ? { alt: alias !== undefined && size.width === undefined ? alias : "" }
          : {})}
        {...size}
        words={words}
        files={files}
      />
    </NodeViewWrapper>
  );
}
