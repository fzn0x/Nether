// A note's history (ADR 0041): the versions this computer keeps of it, and
// for a vault synced with a workspace the server can read, the server's,
// the latest first, each shown as what changed from it to the note now.
// Restoring one keeps the note as it is now as a version first, so a
// restore is undone the same way. How many days this computer keeps
// versions is set here.
import { type NoteEntry, type Vault, defaultHistoryDays } from "@nether/storage";
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { backend } from "./backend.ts";
import {
  type ListedVersion,
  historyDiff,
  localVersions,
  restoreVersion,
  serverVersions,
} from "./history.ts";
import { t } from "./messages.ts";
import { type VaultLink, hostOf } from "./sync.ts";
import { useModal } from "./useModal.ts";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The versions of both places, the latest first. */
function merged(here: readonly ListedVersion[], server: readonly ListedVersion[]): ListedVersion[] {
  return [...here, ...server].sort((a, b) => b.time - a.time);
}

export function HistoryDialog(props: {
  readonly vault: Vault;
  readonly note: NoteEntry;
  /** The workspace the vault syncs with, whose server may keep versions too. */
  readonly link: VaultLink | undefined;
  readonly onClose: () => void;
}) {
  const { vault, note, link, onClose } = props;
  const [here, setHere] = useState<readonly ListedVersion[] | undefined>();
  const [server, setServer] = useState<readonly ListedVersion[]>([]);
  const [serverProblem, setServerProblem] = useState<string | undefined>();
  // The note as it is now, and the chosen version's text.
  const [now, setNow] = useState<string | undefined>();
  const [chosen, setChosen] = useState<string | undefined>();
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
    Promise.all([localVersions(vault, note.id), vault.read(note.id), vault.historyDays()]).then(
      ([list, file, days]) => {
        if (!current) return;
        setHere(list);
        setNow(file.missing === true ? "" : file.text);
        setKeepDays(days);
        setDaysDraft(String(days));
      },
      report,
    );
    return () => {
      current = false;
    };
  }, [vault, note.id, report]);

  // The server's versions come when they come; without them, this computer's still show.
  useEffect(() => {
    if (link === undefined || link.encrypted === true) return;
    let current = true;
    // Read through a function: the effect's cleanup changes it during the waits.
    const live = () => current;
    void (async () => {
      try {
        const token = await backend.serverToken(link.server);
        if (token === undefined) return;
        const found = await serverVersions(backend.serverFetch, link, token, note.id);
        if (live()) setServer(found);
      } catch (reason) {
        if (!live()) return;
        setServerProblem(
          t("historyServerFailed", {
            server: hostOf(link.server),
            error: reason instanceof Error ? reason.message : String(reason),
          }),
        );
      }
    })();
    return () => {
      current = false;
    };
  }, [link, note.id]);

  const versions = useMemo(
    () => (here === undefined ? undefined : merged(here, server)),
    [here, server],
  );
  // The latest is chosen until someone chooses another.
  const shown = chosen ?? versions?.[0]?.key;
  const version = versions?.find((item) => item.key === shown);

  useEffect(() => {
    setText(undefined);
    if (version === undefined) return;
    let current = true;
    version.text().then((found) => {
      if (current) setText(found);
    }, report);
    return () => {
      current = false;
    };
  }, [version, report]);

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
              {versions.map((item, index) => (
                <label key={item.key} className="field-check">
                  <input
                    type="radio"
                    name="history-version"
                    checked={shown === item.key}
                    autoFocus={index === 0}
                    onChange={() => {
                      setChosen(item.key);
                    }}
                  />
                  {when.format(item.time)}
                  {link === undefined ? null : (
                    <span className="hint">
                      {item.where === "here"
                        ? t("historyHere")
                        : t("historyOnServer", { server: hostOf(link.server) })}
                    </span>
                  )}
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
        {serverProblem === undefined ? null : <p role="status">{serverProblem}</p>}
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
