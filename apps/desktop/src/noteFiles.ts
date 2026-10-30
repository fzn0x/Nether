// The files of a note, for its editor: the vault finds the file a link
// names, as Obsidian does, and the app's media server or the browser
// preview gives the URL it loads from. Files pasted or dropped into a note
// go in the vault's attachments folder.
import type { NoteId } from "@nether/core";
import type { NoteFiles } from "@nether/editor";
import type { Vault } from "@nether/storage";
import type { VaultMedia } from "./backend.ts";

/** The folder, from the vault's, that pasted and dropped files go in. */
export const attachmentsFolder = "attachments";

function stamp(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    two(date.getMonth() + 1) +
    two(date.getDate()) +
    two(date.getHours()) +
    two(date.getMinutes()) +
    two(date.getSeconds())
  );
}

/**
 * The name a pasted or dropped file gets in the vault: its own, without
 * the characters file systems or wiki links cannot hold, or for a pasted
 * image, which browsers all name "image.png", "Pasted image" and the time,
 * as Obsidian names them.
 */
export function attachmentName(file: File, pasted: boolean, now: Date): string {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
  if (file.name === "" || (pasted && /^image\.\w+$/i.test(file.name))) {
    const type = /^image\/(\w+)/.exec(file.type)?.[1];
    return `Pasted image ${stamp(now)}${extension === "" ? `.${type ?? "png"}` : extension}`;
  }
  const safe = file.name
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/^[.\s]+/, "")
    .trim();
  return safe === "" ? `Attachment ${stamp(now)}${extension}` : safe;
}

/** The files of the note with ID `id`, read from where the note is now. */
export function noteFiles(
  vault: Vault,
  media: VaultMedia,
  id: NoteId,
  report: (error: unknown) => void,
): NoteFiles {
  const from = () => vault.note(id)?.path ?? "";
  const find = (link: string) => vault.resolveFile(link, from());
  const files: NoteFiles = {
    url(link) {
      const path = find(link);
      return path === undefined ? undefined : media.url(path);
    },
    async attach(file, pasted) {
      try {
        const name = attachmentName(file, pasted, new Date());
        const data = new Uint8Array(await file.arrayBuffer());
        const path = await vault.attach(`${attachmentsFolder}/${name}`, data);
        return vault.linkTo(path, from());
      } catch (error) {
        report(error);
        return undefined;
      }
    },
  };
  const { open, reveal } = media;
  if (open !== undefined) {
    files.open = (link) => {
      const path = find(link);
      if (path !== undefined) open(path).catch(report);
    };
  }
  if (reveal !== undefined) {
    files.reveal = (link) => {
      const path = find(link);
      if (path !== undefined) reveal(path).catch(report);
    };
  }
  return files;
}
