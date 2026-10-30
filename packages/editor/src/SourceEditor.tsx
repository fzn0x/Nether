// A note's Markdown as text, in CodeMirror: source mode, for every
// character. The text is the file's, line endings included, so going back
// to blocks loses nothing. Vim keys load when someone turns them on.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
import { tagHighlighter, tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

export interface SourceEditorProps {
  /** The note's Markdown when the editor opens; later changes to it are not applied. */
  readonly text: string;
  /** Called with the whole text after each change the user makes. */
  readonly onChange: (text: string) => void;
  /** The accessible name of the editing area. */
  readonly label: string;
  /** What an empty note shows. */
  readonly placeholder?: string;
  /** Whether the keys work as in Vim. */
  readonly vim?: boolean;
  readonly autofocus?: boolean;
}

/** The line ending a text uses first, which the editor keeps; `\n` for none. */
export function lineSeparatorOf(text: string): string {
  return /\r\n|\r|\n/.exec(text)?.[0] ?? "\n";
}

/** Classes for Markdown's parts, which the app's styles color as its theme wants. */
const markdownClasses = tagHighlighter([
  { tag: tags.heading, class: "md-heading" },
  { tag: tags.emphasis, class: "md-emphasis" },
  { tag: tags.strong, class: "md-strong" },
  { tag: tags.strikethrough, class: "md-strike" },
  { tag: [tags.link, tags.url], class: "md-link" },
  { tag: tags.monospace, class: "md-code" },
  { tag: tags.quote, class: "md-quote" },
  { tag: tags.comment, class: "md-comment" },
  // The marks around the text: #, *, `, >, list bullets, link brackets.
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], class: "md-mark" },
]);

let loadingVim: Promise<Extension> | undefined;

function loadVim(): Promise<Extension> {
  loadingVim ??= import("@replit/codemirror-vim").then(({ vim }) => vim());
  return loadingVim;
}

export function SourceEditor(props: SourceEditorProps) {
  const { text, onChange, label, placeholder: empty = "", vim = false, autofocus = false } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const keys = useRef(new Compartment());
  // The latest callback, so the editor need not be made again when it changes.
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          // First, so Vim's keys come before the others.
          keys.current.of([]),
          EditorState.lineSeparator.of(lineSeparatorOf(text)),
          history(),
          drawSelection(),
          search({ top: true }),
          highlightSelectionMatches(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownClasses),
          EditorView.lineWrapping,
          placeholder(empty),
          // Tab indents; Escape, then Tab, leaves the editor, as CodeMirror documents.
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true" }),
          EditorView.updateListener.of((update) => {
            // sliceDoc joins lines with the file's line ending; doc.toString() always with "\n".
            if (update.docChanged) changed.current(update.state.sliceDoc());
          }),
        ],
      }),
    });
    view.current = editor;
    if (autofocus) editor.focus();
    return () => {
      editor.destroy();
      view.current = undefined;
    };
    // The editor is made once; `text` and the rest are its first state.
  }, []);

  useEffect(() => {
    let current = true;
    const apply = (extension: Extension) => {
      if (current) view.current?.dispatch({ effects: keys.current.reconfigure(extension) });
    };
    if (vim) void loadVim().then(apply);
    else apply([]);
    return () => {
      current = false;
    };
  }, [vim]);

  return <div className="source-editor" ref={host} />;
}
