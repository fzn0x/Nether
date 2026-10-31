// Asks for one line of text, as an arrow's label or a link's address: the
// field filled with what it was, chosen to type over; Enter keeps it, and
// Escape or Cancel leaves it as it was.
import { type SyntheticEvent, useRef, useState } from "react";
import { t } from "./messages.ts";
import { useModal } from "./useModal.ts";

export function TextPromptDialog(props: {
  readonly title: string;
  readonly label: string;
  readonly value: string;
  /** Why the text cannot be kept, if it cannot. */
  readonly check?: (value: string) => string | undefined;
  readonly onSubmit: (value: string) => void;
  readonly onClose: () => void;
}) {
  const { title, label, value, check, onSubmit, onClose } = props;
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | undefined>();
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const problem = check?.(text.trim());
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    onSubmit(text.trim());
    onClose();
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
        className="switcher dialog text-prompt-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-prompt-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <h2 id="text-prompt-title">{title}</h2>
        <label className="field">
          {label}
          <input
            value={text}
            spellCheck={false}
            autoFocus
            aria-invalid={error === undefined ? undefined : true}
            onFocus={(event) => {
              event.target.select();
            }}
            onChange={(event) => {
              setText(event.target.value);
              setError(undefined);
            }}
          />
        </label>
        {error === undefined ? null : <p role="alert">{error}</p>}
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
