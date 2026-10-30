// Files in a note, as the app that shows it finds them: the URL a link's
// file loads from, what kind of file it is, and the files pasted or dropped
// into a note, which the app adds to the vault and the note embeds where
// they land.
import { Extension } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** Where a note's files come from, which the app that shows the note knows. */
export interface NoteFiles {
  /**
   * The URL the page loads the file a link names from, the link read from
   * the note's folder as Obsidian reads it, or undefined when there is no
   * such file.
   */
  url(link: string): string | undefined;
  /** Opens a media file, such as a PDF, in the system's app for it. */
  open?(link: string): void;
  /** Shows a file in the system's file manager. */
  reveal?(link: string): void;
  /**
   * Adds a file pasted or dropped into the note to the vault, and returns
   * the link that embeds it, or undefined when it could not, which the app
   * tells the user.
   */
  attach?(file: File, pasted: boolean): Promise<string | undefined>;
}

export type FileKind = "image" | "pdf" | "audio" | "video" | "file";

const kinds: readonly [RegExp, FileKind][] = [
  [/\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i, "image"],
  [/\.pdf$/i, "pdf"],
  [/\.(aac|flac|m4a|mp3|oga|ogg|opus|wav)$/i, "audio"],
  [/\.(3gp|m4v|mkv|mov|mp4|ogv|webm)$/i, "video"],
];

/** What a file is, by the extension of its path or URL. */
export function fileKind(link: string): FileKind {
  const path = link.split(/[?#]/)[0] ?? link;
  return kinds.find(([pattern]) => pattern.test(path))?.[1] ?? "file";
}

/** Whether a link names a note, which embeds as a note, rather than another file. */
export function isNoteLink(link: string): boolean {
  const name = link.slice(link.lastIndexOf("/") + 1);
  return !/\.[A-Za-z0-9]{1,8}$/.test(name) || /\.md$/i.test(name);
}

const web = /^(https?:\/\/|data:image\/)/i;

/** Whether a link is to the web, or an image in the link itself, rather than a file of the vault. */
export function isWebLink(link: string): boolean {
  return web.test(link);
}

/** A Markdown link's path, its `%20`s read as spaces. */
export function markdownPath(src: string): string {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

/** The URL of a file a note links to; web links stay as they are. */
export function fileUrl(
  files: NoteFiles | undefined,
  link: string,
  markdown: boolean,
): string | undefined {
  if (web.test(link)) return link;
  return files?.url(markdown ? markdownPath(link) : link);
}

/** An embed's size, Obsidian's `![[photo.png|300]]` or `|300x200`. */
export function embedSize(alias: string | undefined): { width?: number; height?: number } {
  const match = /^\s*(\d{1,5})(?:x(\d{1,5}))?\s*$/.exec(alias ?? "");
  if (match === null) return {};
  const width = Number(match[1]);
  const height = match[2] === undefined ? undefined : Number(match[2]);
  return {
    ...(width > 0 ? { width } : {}),
    ...(height !== undefined && height > 0 ? { height } : {}),
  };
}

export const fileDropKey = new PluginKey("fileDrop");

/** The files of a paste or drop that can be added to the vault: not notes, which open as notes. */
function droppedFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => !/\.md$/i.test(file.name));
}

/** Embeds the links at `pos`, or where the selection is, each as a block of its own. */
function insertEmbeds(view: EditorView, links: readonly string[], pos: number | undefined) {
  const embed = view.state.schema.nodes.embed;
  if (links.length === 0 || embed === undefined) return;
  const content = Fragment.from(links.map((link) => embed.create({ target: { title: link } })));
  const tr = view.state.tr;
  if (pos === undefined) tr.replaceSelection(new Slice(content, 0, 0));
  else tr.insert(Math.min(pos, tr.doc.content.size), content);
  view.dispatch(tr.scrollIntoView());
}

/** Adds files pasted or dropped into the note to the vault, and embeds them where they land. */
export const FileDrop = Extension.create<{ files: NoteFiles | undefined }>({
  name: "fileDrop",

  addOptions() {
    return { files: undefined };
  },

  addProseMirrorPlugins() {
    const attach = this.options.files?.attach?.bind(this.options.files);
    if (attach === undefined) return [];
    const add = async (
      view: EditorView,
      list: File[],
      pasted: boolean,
      pos: number | undefined,
    ) => {
      const links: string[] = [];
      for (const file of list) {
        // The app tells the user about a file it could not add; the rest still go in.
        const link = await attach(file, pasted).catch(() => undefined);
        if (link !== undefined) links.push(link);
      }
      if (!view.isDestroyed) insertEmbeds(view, links, pos);
    };
    return [
      new Plugin({
        key: fileDropKey,
        props: {
          handlePaste: (view, event) => {
            const list = droppedFiles(event.clipboardData?.files);
            if (list.length === 0) return false;
            void add(view, list, true, undefined);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const list = droppedFiles(event.dataTransfer?.files);
            if (list.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const $pos = at === null ? undefined : view.state.doc.resolve(at.pos);
            // After the block the drop lands in, at the top level of the note.
            const pos =
              $pos === undefined
                ? view.state.doc.content.size
                : $pos.depth === 0
                  ? $pos.pos
                  : $pos.after(1);
            void add(view, list, false, pos);
            return true;
          },
        },
      }),
    ];
  },
});
