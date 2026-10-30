// The command palette, Ctrl or Cmd and P: every action of the app, found
// by typing part of its name, each with its shortcut, run with Enter. A
// dialog over the vault, whose field keeps focus while the arrow keys
// move through the commands it lists.
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { t } from "./messages.ts";
import { matchScore } from "./noteLinks.ts";
import { formatKeys } from "./shortcuts.ts";
import { useModal } from "./useModal.ts";

export interface PaletteCommand {
  readonly id: string;
  readonly name: string;
  readonly keys: readonly string[];
}

export function CommandPalette(props: {
  readonly commands: readonly PaletteCommand[];
  readonly onRun: (id: string) => void;
  readonly onClose: () => void;
}) {
  const { commands, onRun, onClose } = props;
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog);
  const matches = useMemo(
    () =>
      commands
        .map((command, index) => ({ command, index, score: matchScore(text, command.name) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(({ command }) => command),
    [commands, text],
  );
  const optionId = (index: number) => `palette-option-${String(index)}`;

  useEffect(() => {
    setActive(0);
  }, [text]);

  useEffect(() => {
    list.current?.querySelector(`#${optionId(active)}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (index: number) => {
    const command = matches[index];
    if (command === undefined) return;
    onClose();
    onRun(command.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + matches.length) % Math.max(1, matches.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(active);
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
        aria-label={t("palette")}
        ref={dialog}
      >
        <input
          className="switcher-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={matches[active] === undefined ? undefined : optionId(active)}
          aria-label={t("paletteLabel")}
          placeholder={t("paletteHint")}
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
          id="palette-list"
          className="switcher-list"
          role="listbox"
          aria-label={t("commands")}
          ref={list}
        >
          {matches.length === 0 ? (
            <li className="slash-empty">{t("noResults")}</li>
          ) : (
            matches.map((command, index) => (
              <li
                key={command.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className="slash-item"
                onMouseMove={() => {
                  if (index !== active) setActive(index);
                }}
                onClick={() => {
                  run(index);
                }}
              >
                {command.name}
                {command.keys.map((keys) => (
                  <kbd key={keys} className="palette-keys">
                    {formatKeys(keys)}
                  </kbd>
                ))}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
