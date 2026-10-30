// The vault's settings for templates and periodic notes: the templates
// folder, how dates and times are written, and for each of the day, the
// week and the month whether the app offers its note, where it goes, how
// it is named, and the template it starts from. Each format shows what it
// writes for now as it is typed.
import { type Period, formatDate } from "@nether/core";
import { type SyntheticEvent, type KeyboardEvent, useEffect, useState } from "react";
import { t } from "./messages.ts";
import {
  type PeriodicSettings,
  type TemplateSettings,
  cleanFolder,
  cleanTemplate,
  periodicNote,
  periods,
} from "./templates.ts";

function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly example?: string;
  readonly list?: string;
}) {
  const { label, value, onChange, example, list } = props;
  return (
    <label className="field">
      {label}
      <input
        value={value}
        spellCheck={false}
        list={list}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {example === undefined ? null : <span className="hint">{example}</span>}
    </label>
  );
}

export function TemplateSettingsDialog(props: {
  readonly settings: TemplateSettings;
  /** The paths of the templates folder's notes, which the template fields suggest. */
  readonly templates: readonly string[];
  /** Keeps the settings; a rejection shows in the dialog, which stays open. */
  readonly onSave: (settings: TemplateSettings) => Promise<void>;
  readonly onClose: () => void;
}) {
  const { settings, templates, onSave, onClose } = props;
  const [draft, setDraft] = useState<TemplateSettings>(settings);
  const [error, setError] = useState<string | undefined>();
  const now = new Date();

  // Focus goes back where it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  const setPeriod = (period: Period, change: Partial<PeriodicSettings>) => {
    setDraft((current) => ({ ...current, [period]: { ...current[period], ...change } }));
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const clean = (period: PeriodicSettings): PeriodicSettings => ({
      enabled: period.enabled,
      folder: cleanFolder(period.folder),
      format: period.format.trim(),
      template: cleanTemplate(period.template),
    });
    const next: TemplateSettings = {
      folder: cleanFolder(draft.folder),
      dateFormat: draft.dateFormat.trim(),
      timeFormat: draft.timeFormat.trim(),
      day: clean(draft.day),
      week: clean(draft.week),
      month: clean(draft.month),
    };
    if (
      next.dateFormat === "" ||
      next.timeFormat === "" ||
      periods.some((period) => next[period].format === "")
    ) {
      setError(t("formatEmpty"));
      return;
    }
    onSave(next).then(onClose, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
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
        // A click outside the dialog closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="switcher dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onSubmit={submit}
        onKeyDown={onKeyDown}
      >
        <h2 id="settings-title">{t("templateSettings")}</h2>
        <datalist id="template-paths">
          {templates.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
        <div className="dialog-body">
          <fieldset>
            <legend>{t("templates")}</legend>
            <TextField
              label={t("templatesFolder")}
              value={draft.folder}
              onChange={(folder) => {
                setDraft((current) => ({ ...current, folder }));
              }}
            />
            <TextField
              label={t("dateFormat")}
              value={draft.dateFormat}
              example={t("formatExample", { text: formatDate(now, draft.dateFormat) })}
              onChange={(dateFormat) => {
                setDraft((current) => ({ ...current, dateFormat }));
              }}
            />
            <TextField
              label={t("timeFormat")}
              value={draft.timeFormat}
              example={t("formatExample", { text: formatDate(now, draft.timeFormat) })}
              onChange={(timeFormat) => {
                setDraft((current) => ({ ...current, timeFormat }));
              }}
            />
          </fieldset>
          {periods.map((period) => {
            const values = draft[period];
            return (
              <fieldset key={period}>
                <legend>{t(`${period}Notes`)}</legend>
                <label className="field-check">
                  <input
                    type="checkbox"
                    checked={values.enabled}
                    onChange={(event) => {
                      setPeriod(period, { enabled: event.target.checked });
                    }}
                  />
                  {t("offerNote")}
                </label>
                <TextField
                  label={t("noteFolder")}
                  value={values.folder}
                  onChange={(folder) => {
                    setPeriod(period, { folder });
                  }}
                />
                <TextField
                  label={t("nameFormat")}
                  value={values.format}
                  example={t("formatExample", {
                    text: values.format.trim() === "" ? "" : periodicNote(draft, period, now).path,
                  })}
                  onChange={(format) => {
                    setPeriod(period, { format });
                  }}
                />
                <TextField
                  label={t("template")}
                  value={values.template}
                  list="template-paths"
                  onChange={(template) => {
                    setPeriod(period, { template });
                  }}
                />
              </fieldset>
            );
          })}
        </div>
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
