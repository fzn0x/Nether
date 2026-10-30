// Exporting from a note: the note, its folder or the whole vault, as
// Markdown files, web pages or a PDF on A4 or Letter. The export runs here,
// showing how far it has come, and can be cancelled; once saved, the file
// can be shown in the system's file manager.
import type { LinkGraph } from "@nether/graph";
import type { NoteEntry, Vault } from "@nether/storage";
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Exporter, VaultMedia } from "./backend.ts";
import type { ExportFormat } from "./exportNotes.ts";
import { t } from "./messages.ts";
import { useModal } from "./useModal.ts";

type Scope = "note" | "folder" | "vault";

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly done: number; readonly total: number }
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "failed"; readonly message: string };

const formats: readonly ExportFormat[] = ["markdown", "html", "pdf"];

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function ExportDialog(props: {
  readonly vault: Vault;
  readonly vaultName: string;
  readonly graph: LinkGraph;
  readonly media: VaultMedia;
  readonly exporter: Exporter;
  readonly note: NoteEntry;
  readonly notes: readonly NoteEntry[];
  readonly onClose: () => void;
}) {
  const { vault, vaultName, graph, media, exporter, note, notes, onClose } = props;
  const folder = folderOf(note.path);
  const [scope, setScope] = useState<Scope>("note");
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [paper, setPaper] = useState<"a4" | "letter">("a4");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const running = useRef<AbortController | undefined>(undefined);

  const chosen = useMemo(
    () =>
      scope === "note"
        ? [note]
        : scope === "folder"
          ? notes.filter((entry) => entry.path.startsWith(`${folder}/`))
          : notes,
    [scope, note, notes, folder],
  );

  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  // An export still running stops when the dialog closes.
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
    setStatus({ kind: "working", done: 0, total: chosen.length });
    const name =
      scope === "note"
        ? note.title
        : scope === "folder"
          ? (folder.split("/").pop() ?? vaultName)
          : vaultName;
    import("./exportNotes.ts")
      .then(({ exportNotes }) =>
        exportNotes({
          vault,
          graph,
          media,
          exporter,
          notes: chosen,
          wholeVault: scope === "vault",
          name,
          format,
          page: { size: paper, landscape: false },
          signal: controller.signal,
          onProgress: (done, total) => {
            if (!controller.signal.aborted) setStatus({ kind: "working", done, total });
          },
        }),
      )
      .then(
        (path) => {
          if (controller.signal.aborted) return;
          setStatus(path === undefined ? { kind: "idle" } : { kind: "saved", path });
        },
        (error: unknown) => {
          setStatus(
            controller.signal.aborted
              ? { kind: "failed", message: t("exportCancelled") }
              : {
                  kind: "failed",
                  message: t("exportFailed", {
                    error: error instanceof Error ? error.message : String(error),
                  }),
                },
          );
        },
      )
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
  const scopes: readonly {
    readonly value: Scope;
    readonly label: string;
    readonly count: number;
  }[] = [
    { value: "note", label: t("exportNote", { title: note.title }), count: 1 },
    ...(folder === ""
      ? []
      : [
          {
            value: "folder" as const,
            label: t("exportFolder", { folder }),
            count: notes.filter((entry) => entry.path.startsWith(`${folder}/`)).length,
          },
        ]),
    { value: "vault", label: t("exportVault"), count: notes.length },
  ];

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        // A click outside the dialog closes it, unless an export is running.
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <form
        className="switcher dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onSubmit={start}
        onKeyDown={onKeyDown}
      >
        <h2 id="export-title">{t("exportTitle")}</h2>
        <fieldset disabled={working}>
          <legend>{t("exportWhat")}</legend>
          {scopes.map((option) => (
            <label key={option.value} className="field-check">
              <input
                type="radio"
                name="export-scope"
                checked={scope === option.value}
                autoFocus={option.value === "note"}
                onChange={() => {
                  setScope(option.value);
                }}
              />
              {option.label}
              <span className="hint">
                {option.count === 1 ? t("oneNote") : t("noteCount", { count: option.count })}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset disabled={working}>
          <legend>{t("exportAs")}</legend>
          {formats.map((value) => (
            <label key={value} className="field-check">
              <input
                type="radio"
                name="export-format"
                checked={format === value}
                onChange={() => {
                  setFormat(value);
                }}
              />
              {t(`format_${value}`)}
            </label>
          ))}
          {format === "pdf" ? (
            <label className="field">
              {t("paper")}
              <select
                value={paper}
                onChange={(event) => {
                  setPaper(event.target.value === "letter" ? "letter" : "a4");
                }}
              >
                <option value="a4">{t("paperA4")}</option>
                <option value="letter">{t("paperLetter")}</option>
              </select>
            </label>
          ) : null}
        </fieldset>
        {status.kind === "working" ? (
          <p role="status">{t("exporting", { done: status.done, total: status.total })}</p>
        ) : status.kind === "saved" ? (
          <p role="status">
            {t("exportSaved", { path: status.path })}
            {exporter.reveal === undefined ? null : (
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  exporter.reveal?.(status.path).catch((error: unknown) => {
                    setStatus({
                      kind: "failed",
                      message: error instanceof Error ? error.message : String(error),
                    });
                  });
                }}
              >
                {t("showInFolder")}
              </button>
            )}
          </p>
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
              {status.kind === "saved" ? t("close") : t("cancel")}
            </button>
          )}
          <button type="submit" className="primary" disabled={working}>
            {t("exportStart")}
          </button>
        </div>
      </form>
    </div>
  );
}
