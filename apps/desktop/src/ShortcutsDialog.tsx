// The keyboard shortcuts of every command, and the keys to change them:
// Change listens for the next keys pressed, Escape stops listening, and
// Backspace leaves the command with none. Keys another command had move
// to this one. A shortcut needs Ctrl, Cmd or Alt, or a function key, so
// that typing never runs a command. The vault keeps the choices.
import { type KeyboardEvent, type SyntheticEvent, useEffect, useRef, useState } from "react";
import { t } from "./messages.ts";
import { type Hotkeys, canBeShortcut, eventKeys, formatKeys } from "./shortcuts.ts";
import { useModal } from "./useModal.ts";

export function ShortcutsDialog(props: {
  readonly commands: readonly { readonly id: string; readonly name: string }[];
  readonly defaults: Hotkeys;
  /** The vault's own choices, over the defaults. */
  readonly chosen: Hotkeys;
  /** Called with true while the dialog listens for keys, so they run no command. */
  readonly onListening: (listening: boolean) => void;
  readonly onSave: (chosen: Hotkeys) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { commands, defaults, onListening, onSave, onClose } = props;
  const [chosen, setChosen] = useState<Hotkeys>(props.chosen);
  const [listening, setListening] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const keysOf = (id: string) => chosen[id] ?? defaults[id] ?? [];

  useEffect(() => {
    onListening(listening !== undefined);
  }, [listening, onListening]);

  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  // Commands run again when the dialog closes.
  useEffect(
    () => () => {
      onListening(false);
    },
    [onListening],
  );

  /** The choices with `id` given `keys`, the default dropped when they match it. */
  const withKeys = (current: Hotkeys, id: string, keys: readonly string[]): Hotkeys => {
    const fallback = defaults[id] ?? [];
    const same = keys.length === fallback.length && keys.every((each, i) => each === fallback[i]);
    const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
    return same ? rest : { ...rest, [id]: keys };
  };

  const listen = (id: string, event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setListening(undefined);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setChosen((current) => withKeys(current, id, []));
      setListening(undefined);
      return;
    }
    const keys = eventKeys(event.nativeEvent);
    if (keys === undefined) return;
    if (!canBeShortcut(keys)) {
      setMessage(t("shortcutNeedsModifier", { keys: formatKeys(keys) }));
      return;
    }
    let next = withKeys(chosen, id, [keys]);
    const other = commands.find(
      (command) =>
        command.id !== id &&
        (next[command.id] ?? defaults[command.id] ?? []).some(
          (each) => each.toLowerCase() === keys.toLowerCase(),
        ),
    );
    if (other !== undefined) {
      next = withKeys(
        next,
        other.id,
        (next[other.id] ?? defaults[other.id] ?? []).filter(
          (each) => each.toLowerCase() !== keys.toLowerCase(),
        ),
      );
      setMessage(t("shortcutMoved", { keys: formatKeys(keys), name: other.name }));
    } else {
      setMessage(undefined);
    }
    setChosen(next);
    setListening(undefined);
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onSave(chosen).then(onClose, (reason: unknown) => {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        // A click outside the dialog closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="switcher dialog settings-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape" && listening === undefined) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h2 id="shortcuts-title">{t("shortcuts")}</h2>
        <div className="dialog-body">
          <table className="shortcuts">
            <thead>
              <tr>
                <th scope="col">{t("command")}</th>
                <th scope="col">{t("shortcut")}</th>
                <th scope="col">
                  <span className="visually-hidden">{t("change")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {commands.map((command) => {
                const keys = keysOf(command.id);
                return (
                  <tr key={command.id}>
                    <th scope="row">{command.name}</th>
                    <td>
                      {keys.length === 0 ? (
                        <span className="hint">{t("noShortcut")}</span>
                      ) : (
                        keys.map((each) => <kbd key={each}>{formatKeys(each)}</kbd>)
                      )}
                    </td>
                    <td className="shortcut-actions">
                      <button
                        type="button"
                        className="quiet"
                        aria-label={t("changeShortcut", { name: command.name })}
                        aria-pressed={listening === command.id}
                        onClick={() => {
                          setMessage(undefined);
                          setListening(listening === command.id ? undefined : command.id);
                        }}
                        onKeyDown={(event) => {
                          if (listening === command.id) listen(command.id, event);
                        }}
                        onBlur={() => {
                          if (listening === command.id) setListening(undefined);
                        }}
                      >
                        {listening === command.id ? t("pressKeys") : t("change")}
                      </button>
                      {command.id in chosen ? (
                        <button
                          type="button"
                          className="quiet"
                          aria-label={t("resetShortcut", { name: command.name })}
                          onClick={() => {
                            setChosen((current) =>
                              withKeys(current, command.id, defaults[command.id] ?? []),
                            );
                          }}
                        >
                          {t("reset")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {message === undefined ? null : <p role="status">{message}</p>}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary">
            {t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
