// Importing into the vault: what to import, chosen from the system's
// dialog, then made in the vault while the dialog shows how far it has
// come; it can be cancelled, keeping what was made. Once done, it says what
// it made and what it could not bring over as it was, and opens the first
// note it made.
import type { Vault } from "@nether/storage";
import { type KeyboardEvent, type SyntheticEvent, useEffect, useRef, useState } from "react";
import type { Importer } from "./backend.ts";
import {
  type ImportChoice,
  type ImportResult,
  importChoices,
  planImport,
  runImport,
} from "./importNotes.ts";
import { type MessageKey, t } from "./messages.ts";
import { useModal } from "./useModal.ts";

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly done: number; readonly total: number }
  | { readonly kind: "done"; readonly result: ImportResult }
  | { readonly kind: "failed"; readonly message: string };

const choices: readonly {
  readonly value: ImportChoice;
  readonly label: MessageKey;
  readonly hint: MessageKey;
}[] = [
  { value: "folder", label: "importFolder", hint: "importFolderHint" },
  { value: "notion", label: "importNotion", hint: "importNotionHint" },
  { value: "markdown", label: "importMarkdown", hint: "importMarkdownHint" },
  { value: "csv", label: "importCsv", hint: "importCsvHint" },
];

/** What an import made, in words. */
function importedText(result: ImportResult): string {
  const notes = result.notes === 1 ? t("oneNote") : t("noteCount", { count: result.notes });
  const files = result.files === 1 ? t("oneFile") : t("fileCount", { count: result.files });
  if (result.folder === "") return t("importedTop", { notes });
  return result.files === 0
    ? t("imported", { notes, folder: result.folder })
    : t("importedWithFiles", { notes, files, folder: result.folder });
}

export function ImportDialog(props: {
  readonly vault: Vault;
  readonly importer: Importer;
  /** Opens a note the import made, by its path. */
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
}) {
  const { vault, importer, onOpen, onClose } = props;
  const [choice, setChoice] = useState<ImportChoice>("folder");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const running = useRef<AbortController | undefined>(undefined);
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  // An import still running stops when the dialog closes, keeping what it made.
  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const start = (event: SyntheticEvent) => {
    event.preventDefault();
    if (status.kind === "working") return;
    const controller = new AbortController();
    running.current = controller;
    void (async () => {
      const opened = await importer.choose(importChoices[choice]);
      if (opened === undefined) return;
      try {
        setStatus({ kind: "working", done: 0, total: 0 });
        const planned = await planImport(vault, choice, opened);
        const result = await runImport(
          vault,
          opened,
          planned,
          (done, total) => {
            if (!controller.signal.aborted) setStatus({ kind: "working", done, total });
          },
          controller.signal,
        );
        setStatus({ kind: "done", result });
      } finally {
        await opened.close();
      }
    })()
      .catch((error: unknown) => {
        setStatus({
          kind: "failed",
          message: controller.signal.aborted
            ? t("importCancelled")
            : t("importFailed", { error: error instanceof Error ? error.message : String(error) }),
        });
      })
      .finally(() => {
        if (running.current === controller) running.current = undefined;
      });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const working = status.kind === "working";
  const result = status.kind === "done" ? status.result : undefined;
  const first = result?.first;
  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        // A click outside the dialog closes it, unless an import is running.
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <form
        className="switcher dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onSubmit={start}
        onKeyDown={onKeyDown}
      >
        <h2 id="import-title">{t("importTitle")}</h2>
        <fieldset disabled={working}>
          <legend>{t("importWhat")}</legend>
          {choices.map((option) => (
            <label key={option.value} className="field-check">
              <input
                type="radio"
                name="import-kind"
                checked={choice === option.value}
                autoFocus={option.value === "folder"}
                onChange={() => {
                  setChoice(option.value);
                }}
              />
              {t(option.label)}
              <span className="hint">{t(option.hint)}</span>
            </label>
          ))}
        </fieldset>
        {status.kind === "working" ? (
          <p role="status">
            {status.total === 0
              ? t("importReading")
              : t("importing", { done: status.done, total: status.total })}
          </p>
        ) : result !== undefined ? (
          <div role="status">
            <p>{importedText(result)}</p>
            {result.warnings.length === 0 ? null : (
              <>
                <p>{t("importWarnings")}</p>
                <ul className="import-warnings">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : status.kind === "failed" ? (
          <p role="alert">{status.message}</p>
        ) : null}
        <div className="dialog-actions">
          {working ? (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                running.current?.abort();
              }}
            >
              {t("cancel")}
            </button>
          ) : (
            <button type="button" className="quiet" onClick={onClose}>
              {result === undefined ? t("cancel") : t("close")}
            </button>
          )}
          {first === undefined ? null : (
            <button
              type="button"
              onClick={() => {
                onOpen(first);
              }}
            >
              {t("importOpen", { title: first.slice(first.lastIndexOf("/") + 1, -3) })}
            </button>
          )}
          <button type="submit" className="primary" disabled={working}>
            {t("importStart")}
          </button>
        </div>
      </form>
    </div>
  );
}
