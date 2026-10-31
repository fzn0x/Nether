// A note's history on this device (ADR 0041): the versions kept of it, the
// latest first, each shown as what changed from it to the note now.
// Restoring one keeps the note as it is now as a version first, so a
// restore is undone the same way. How many days versions are kept is set
// here.
import { type NoteEntry, type NoteVersion, type Vault, defaultHistoryDays } from "@nether/storage";
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { historyDiff, restoreVersion } from "./history.ts";
import { t } from "./messages.ts";
import { useModal } from "./useModal.ts";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function HistoryDialog(props: {
  readonly vault: Vault;
  readonly note: NoteEntry;
  readonly onClose: () => void;
}) {
  const { vault, note, onClose } = props;
  const [versions, setVersions] = useState<readonly NoteVersion[] | undefined>();
  // The note as it is now, and the chosen version's text.
  const [now, setNow] = useState<string | undefined>();
  const [chosen, setChosen] = useState<number | undefined>();
  const [text, setText] = useState<string | undefined>();
  const [keepDays, setKeepDays] = useState(defaultHistoryDays);
  const [daysDraft, setDaysDraft] = useState(String(defaultHistoryDays));
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  const report = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason));
  }, []);

  useEffect(() => {
    let current = true;
    Promise.all([vault.versions(note.id), vault.read(note.id), vault.historyDays()]).then(
      ([list, file, days]) => {
        if (!current) return;
        setVersions(list);
        setNow(file.missing === true ? "" : file.text);
        setChosen(list[0]?.id);
        setKeepDays(days);
        setDaysDraft(String(days));
      },
      report,
    );
    return () => {
      current = false;
    };
  }, [vault, note.id, report]);

  useEffect(() => {
    setText(undefined);
    if (chosen === undefined) return;
    let current = true;
    vault.versionText(chosen).then((found) => {
      if (current) setText(found ?? "");
    }, report);
    return () => {
      current = false;
    };
  }, [vault, chosen, report]);

  const rows = useMemo(
    () => (text === undefined || now === undefined ? undefined : historyDiff(text, now)),
    [text, now],
  );

  const restore = (event: SyntheticEvent) => {
    event.preventDefault();
    if (text === undefined || restoring) return;
    setRestoring(true);
    setError(undefined);
    restoreVersion(vault, note.id, text).then(onClose, (reason: unknown) => {
      report(reason);
      setRestoring(false);
    });
  };

  const saveDays = () => {
    const days = Number(daysDraft);
    if (!Number.isInteger(days) || days < 1) {
      setDaysDraft(String(keepDays));
      return;
    }
    if (days === keepDays) return;
    vault.setHistoryDays(days).then(() => {
      setKeepDays(days);
    }, report);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !restoring) onClose();
      }}
    >
      <form
        className="switcher dialog history-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onSubmit={restore}
        onKeyDown={onKeyDown}
      >
        <h2 id="history-title">{t("historyTitle", { title: note.title })}</h2>
        {versions === undefined ? null : versions.length === 0 ? (
          <p className="placeholder">{t("historyEmpty")}</p>
        ) : (
          <div className="history-body">
            <fieldset className="history-versions" disabled={restoring}>
              <legend>{t("historyVersions")}</legend>
              {versions.map((version, index) => (
                <label key={version.id} className="field-check">
                  <input
                    type="radio"
                    name="history-version"
                    checked={chosen === version.id}
                    autoFocus={index === 0}
                    onChange={() => {
                      setChosen(version.id);
                    }}
                  />
                  {when.format(version.time)}
                </label>
              ))}
            </fieldset>
            <section className="history-diff" aria-label={t("historyChanges")} tabIndex={0}>
              {rows === undefined ? null : rows.length === 0 ? (
                <p className="placeholder">{t("historySame")}</p>
              ) : (
                rows.map((row, index) =>
                  row.kind === "folded" ? (
                    <p key={index} className="diff-folded">
                      {row.count === 1
                        ? t("historyOneUnchanged")
                        : t("historyUnchanged", { count: row.count })}
                    </p>
                  ) : row.kind === "same" ? (
                    <pre key={index} className="diff-same">
                      {row.lines.join("\n")}
                    </pre>
                  ) : row.kind === "removed" ? (
                    <del key={index} className="diff-removed">
                      <span className="visually-hidden">{t("historyRemoved")}</span>
                      <pre>{row.lines.join("\n")}</pre>
                    </del>
                  ) : (
                    <ins key={index} className="diff-added">
                      <span className="visually-hidden">{t("historyAdded")}</span>
                      <pre>{row.lines.join("\n")}</pre>
                    </ins>
                  ),
                )
              )}
            </section>
          </div>
        )}
        <label className="history-days">
          {t("historyKeep")}
          <input
            type="number"
            min={1}
            step={1}
            value={daysDraft}
            onChange={(event) => {
              setDaysDraft(event.target.value);
            }}
            onBlur={saveDays}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveDays();
              }
            }}
          />
          {t("days")}
        </label>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onClose} disabled={restoring}>
            {t("close")}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={text === undefined || restoring || rows?.length === 0}
          >
            {t("historyRestore")}
          </button>
        </div>
      </form>
    </div>
  );
}
