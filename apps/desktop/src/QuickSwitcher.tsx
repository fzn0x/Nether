// The quick switcher, Ctrl or Cmd and O: type a note's name, alias or path
// and press Enter to open it. A dialog over the vault, whose field keeps
// focus while the arrow keys move through the notes it lists.
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import type { Vault } from "@nether/storage";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { t } from "./messages.ts";
import { switcherMatches } from "./search.ts";
import { useModal } from "./useModal.ts";

function folderOf(path: string): string | undefined {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? undefined : path.slice(0, slash);
}

export function QuickSwitcher(props: {
  readonly vault: Vault;
  readonly graph: LinkGraph;
  readonly onOpen: (id: NoteId) => void;
  readonly onClose: () => void;
  /** What the dialog is called, when it picks a note for something other than opening it. */
  readonly label?: string;
}) {
  const { vault, graph, onOpen, onClose, label } = props;
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => switcherMatches(vault, graph, text), [vault, graph, text]);
  const current = matches[active];
  const optionId = (index: number) => `switcher-option-${String(index)}`;

  useEffect(() => {
    setActive(0);
  }, [text]);

  useModal(dialog);

  useEffect(() => {
    list.current?.querySelector(`#${optionId(active)}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (index: number) => {
    const match = matches[index];
    if (match === undefined) return;
    onOpen(match.note.id);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + matches.length) % Math.max(1, matches.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        // A click outside the dialog closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="switcher"
        role="dialog"
        aria-modal="true"
        aria-label={label ?? t("switcher")}
        ref={dialog}
      >
        <input
          className="switcher-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="switcher-list"
          aria-autocomplete="list"
          aria-activedescendant={current === undefined ? undefined : optionId(active)}
          aria-label={t("switcherLabel")}
          placeholder={t("switcherHint")}
          value={text}
          spellCheck={false}
          // The dialog opens to be typed in.
          autoFocus
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          id="switcher-list"
          className="switcher-list"
          role="listbox"
          aria-label={t("notes")}
          ref={list}
        >
          {matches.length === 0 ? (
            <li className="slash-empty">{t("noResults")}</li>
          ) : (
            matches.map((match, index) => {
              const folder = folderOf(match.note.path);
              return (
                <li
                  key={`${match.note.id}${match.alias ?? ""}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  className="slash-item"
                  onMouseMove={() => {
                    if (index !== active) setActive(index);
                  }}
                  onClick={() => {
                    choose(index);
                  }}
                >
                  {match.alias ?? match.note.title}
                  {match.alias === undefined ? null : (
                    <span className="slash-detail">{match.note.title}</span>
                  )}
                  {folder === undefined ? null : <span className="slash-detail">{folder}</span>}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
