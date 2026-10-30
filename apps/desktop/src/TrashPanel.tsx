// The vault's trash, in the sidebar: each note removed, with where it was,
// when it went and how long it stays; a note restored goes back where it
// was. Deleting one for good, or emptying the trash, asks once more. How
// many days the trash keeps notes is set here.
import { type TrashItem, defaultKeepDays } from "@nether/storage";
import type { Vault } from "@nether/storage";
import { useCallback, useEffect, useState } from "react";
import { t } from "./messages.ts";

const dayLength = 86_400_000;
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** When an item went to the trash, as "today", "yesterday" or "3 days ago". */
function deletedWhen(deleted: number, now: number): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.ceil((startOfToday - deleted) / dayLength);
  return relative.format(-Math.max(0, days), "day");
}

/** How long an item stays before it is deleted for good. */
function timeLeft(deleted: number, keepDays: number, now: number): string {
  const days = Math.ceil((deleted + keepDays * dayLength - now) / dayLength);
  if (days <= 0) return t("trashGoesNow");
  return days === 1 ? t("trashOneDayLeft") : t("trashDaysLeft", { count: days });
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

function folderOf(path: string): string | undefined {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? undefined : path.slice(0, slash);
}

export function TrashPanel(props: {
  readonly vault: Vault;
  /** Opens a note once it is restored. */
  readonly onRestored: (path: string) => void;
}) {
  const { vault, onRestored } = props;
  const [items, setItems] = useState<readonly TrashItem[] | undefined>();
  const [keepDays, setKeepDays] = useState(defaultKeepDays);
  const [daysDraft, setDaysDraft] = useState(String(defaultKeepDays));
  // What asks once more before it goes for good: an item's path, or "all" for the whole trash.
  const [confirming, setConfirming] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const now = Date.now();

  const report = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason));
  }, []);

  const load = useCallback(async () => {
    const [trash, days] = await Promise.all([vault.trash(), vault.trashDays()]);
    setItems(trash);
    setKeepDays(days);
    setDaysDraft(String(days));
  }, [vault]);

  useEffect(() => {
    load().catch(report);
    // A note removed while the trash shows joins it.
    return vault.subscribe(() => {
      vault.trash().then(setItems, report);
    });
  }, [vault, load, report]);

  const act = (task: Promise<unknown>) => {
    setError(undefined);
    setConfirming(undefined);
    task.then(() => load(), report);
  };

  const saveDays = () => {
    const days = Number(daysDraft);
    if (!Number.isInteger(days) || days < 1) {
      setDaysDraft(String(keepDays));
      return;
    }
    if (days !== keepDays) act(vault.setTrashDays(days));
  };

  if (items === undefined) return null;
  return (
    <section className="trash-panel" aria-label={t("trash")}>
      {items.length === 0 ? (
        <p className="placeholder">{t("trashEmpty")}</p>
      ) : (
        <ul className="trash-list">
          {items.map((item) => {
            const folder = folderOf(item.from);
            const name = nameOf(item.from);
            return (
              <li key={item.path} className="trash-item">
                <span className="note-title">{name}</span>
                {folder === undefined ? null : <span className="note-folder">{folder}</span>}
                <span className="trash-when">
                  {t("trashDeleted", {
                    when: deletedWhen(item.deleted, now),
                    left: timeLeft(item.deleted, keepDays, now),
                  })}
                </span>
                {confirming === item.path ? (
                  <span
                    className="trash-actions"
                    role="group"
                    aria-label={t("confirmErase", { name })}
                  >
                    <span>{t("confirmErase", { name })}</span>
                    <button
                      type="button"
                      className="quiet danger"
                      onClick={() => {
                        act(vault.erase(item.path));
                      }}
                    >
                      {t("eraseNote")}
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        setConfirming(undefined);
                      }}
                    >
                      {t("cancel")}
                    </button>
                  </span>
                ) : (
                  <span className="trash-actions">
                    <button
                      type="button"
                      className="quiet"
                      aria-label={t("restoreNamed", { name })}
                      onClick={() => {
                        setError(undefined);
                        vault.restore(item.path).then(onRestored, report);
                      }}
                    >
                      {t("restore")}
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      aria-label={t("eraseNamed", { name })}
                      onClick={() => {
                        setConfirming(item.path);
                      }}
                    >
                      {t("eraseNote")}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error === undefined ? null : <p role="alert">{error}</p>}
      <div className="trash-footer">
        <label className="trash-days">
          {t("trashKeep")}
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
              if (event.key === "Enter") saveDays();
            }}
          />
          {t("days")}
        </label>
        {items.length === 0 ? null : confirming === "all" ? (
          <span
            className="trash-actions"
            role="group"
            aria-label={t("confirmEmpty", { count: items.length })}
          >
            <span>{t("confirmEmpty", { count: items.length })}</span>
            <button
              type="button"
              className="quiet danger"
              onClick={() => {
                act(vault.emptyTrash());
              }}
            >
              {t("emptyTrash")}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setConfirming(undefined);
              }}
            >
              {t("cancel")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setConfirming("all");
            }}
          >
            {t("emptyTrash")}
          </button>
        )}
      </div>
    </section>
  );
}
