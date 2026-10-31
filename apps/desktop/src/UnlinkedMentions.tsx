// A note's unlinked mentions, beside it under its backlinks: the other notes
// that write its name or an alias without linking it, found when the list
// is opened, as that reads their files, and found again for each note while
// it stays open. One click makes a mention a link.
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import type { Mention } from "@nether/markdown";
import type { Vault } from "@nether/storage";
import { useEffect, useState } from "react";
import { type NoteMentions, linkMentionIn, unlinkedMentions } from "./mentions.ts";
import { t } from "./messages.ts";

/** The words of a mention's line around it, shortened at either end. */
function around(mention: Mention): { readonly before: string; readonly after: string } {
  const before = mention.line.slice(0, mention.column).trimStart();
  const after = mention.line.slice(mention.column + mention.text.length).trimEnd();
  return {
    before: before.length > 60 ? `…${before.slice(-60).trimStart()}` : before,
    after: after.length > 80 ? `${after.slice(0, 80).trimEnd()}…` : after,
  };
}

export function UnlinkedMentions(props: {
  readonly vault: Vault;
  readonly graph: LinkGraph;
  readonly id: NoteId;
  readonly onOpenNote: (id: NoteId) => void;
}) {
  const { vault, graph, id, onOpenNote } = props;
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<readonly NoteMentions[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  // Changes when a mention is linked, to find the rest again.
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setFound(undefined);
    unlinkedMentions(vault, graph, id).then(
      (result) => {
        if (current) setFound(result);
      },
      (problem: unknown) => {
        if (current) setError(problem instanceof Error ? problem.message : String(problem));
      },
    );
    return () => {
      current = false;
    };
  }, [open, vault, graph, id, round]);

  return (
    <section aria-labelledby="mentions-title">
      <h2 id="mentions-title">
        <button
          type="button"
          className="panel-disclosure"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setError(undefined);
          }}
        >
          {t("unlinkedMentions")}
        </button>
      </h2>
      {!open ? null : found === undefined ? (
        <p className="placeholder" role="status">
          {t("findingMentions")}
        </p>
      ) : found.length === 0 ? (
        <p className="placeholder">{t("noMentions")}</p>
      ) : (
        <ul className="backlinks">
          {found.map(({ note, mentions }) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => {
                  onOpenNote(note.id);
                }}
              >
                {note.title}
              </button>
              {mentions.map((mention) => {
                const { before, after } = around(mention);
                return (
                  <p key={mention.start} className="backlink-context mention">
                    <span>
                      {before}
                      <mark>{mention.text}</mark>
                      {after}
                    </span>
                    <button
                      type="button"
                      className="mention-link"
                      aria-label={t("linkMentionIn", { title: note.title })}
                      onClick={() => {
                        setError(undefined);
                        linkMentionIn(vault, graph, id, note.id, mention).then(
                          () => {
                            setRound((count) => count + 1);
                          },
                          (problem: unknown) => {
                            setError(problem instanceof Error ? problem.message : String(problem));
                          },
                        );
                      }}
                    >
                      {t("linkMention")}
                    </button>
                  </p>
                );
              })}
            </li>
          ))}
        </ul>
      )}
      {error === undefined ? null : <p role="alert">{t("mentionFailed", { error })}</p>}
    </section>
  );
}
