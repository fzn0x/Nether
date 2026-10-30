// Makes a note, from a template or blank. A template's variables are filled
// and its text written as the note's file. When it places the cursor, the
// note's Yjs document is made here too, holding the block the cursor goes
// in, which the file may have no way to write, such as an empty line; the
// note then opens with the cursor there. This loads with the editor.
import { type NoteId, type TemplateValues, fillTemplate } from "@nether/core";
import { setDocumentBlocks, setDocumentProperties } from "@nether/editor";
import { type TemplateCursor, templateNote } from "@nether/markdown";
import type { Vault } from "@nether/storage";
import * as Y from "yjs";

/** Where `{{cursor}}` was while the template is read: a character of Unicode's private use area. */
const cursorMarker = "";

export interface CreatedNote {
  readonly id: NoteId;
  /** Where the cursor goes, when the template placed it. */
  readonly cursor?: TemplateCursor;
}

/** Makes a note at `path`, blank or from a template's text and the values of its variables. */
export async function createNote(
  vault: Vault,
  path: string,
  template?: { readonly text: string; readonly values: TemplateValues },
): Promise<CreatedNote> {
  if (template === undefined) return { id: (await vault.create(path, "")).id };
  if (template.text.includes(cursorMarker)) {
    // A template that has the marker's character already keeps it, and places no cursor.
    const text = fillTemplate(template.text, template.values);
    return { id: (await vault.create(path, text)).id };
  }
  const note = templateNote(
    fillTemplate(template.text, template.values, cursorMarker),
    cursorMarker,
  );
  const created = await vault.create(path, note.text);
  if (note.cursor === undefined) return { id: created.id };
  const document = new Y.Doc();
  document.transact(() => {
    setDocumentBlocks(document, note.content);
    setDocumentProperties(document, note.properties);
  });
  await vault.documents.appendUpdates(created.id, [Y.encodeStateAsUpdate(document)]);
  document.destroy();
  // The document and the file agree, so the note opens from the document.
  const file = await vault.read(created.id);
  if (file.missing !== true) await vault.documents.setFileHash(created.id, file.hash);
  return { id: created.id, cursor: note.cursor };
}
