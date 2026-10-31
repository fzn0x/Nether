// A note's comments, beside it (ADR 0044): a thread for each range of its
// text commented on, the oldest first, each with its comments, a reply box
// and a button that resolves or reopens it. Resolved threads fold away
// under a heading of their own. Each person edits and deletes their own
// comments; those who may only view read them.
import {
  type CommentAnchor,
  type CommentAuthor,
  type CommentThread,
  type NoteComment,
  deleteComment,
  editComment,
  reopenThread,
  reply,
  resolveThread,
  startThread,
} from "@nether/editor";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { t } from "./messages.ts";
import type { OpenComments } from "./useComments.ts";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A box to write a comment in: Ctrl or Cmd and Enter sends it, Escape gives up. */
function CommentBox(props: {
  readonly label: string;
  readonly action: string;
  readonly initial?: string;
  readonly autoFocus?: boolean;
  readonly onSubmit: (body: string) => void;
  readonly onCancel?: (() => void) | undefined;
}) {
  const { label, action, initial = "", autoFocus = false, onSubmit, onCancel } = props;
  const [body, setBody] = useState(initial);
  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (text === "") return;
    onSubmit(text);
    setBody("");
  };
  return (
    <form className="comment-box" onSubmit={submit}>
      <textarea
        aria-label={label}
        placeholder={label}
        value={body}
        rows={2}
        autoFocus={autoFocus}
        onChange={(event) => {
          setBody(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape" && onCancel !== undefined) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="comment-box-actions">
        <button type="submit" className="comment-send" disabled={body.trim() === ""}>
          {action}
        </button>
        {onCancel === undefined ? null : (
          <button type="button" className="comment-action" onClick={onCancel}>
            {t("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

/** One comment: who wrote it and when, what it says, and, for its writer, edit and delete. */
function CommentItem(props: {
  readonly comment: NoteComment;
  readonly mine: boolean;
  readonly onEdit: (body: string) => void;
  readonly onDelete: () => void;
}) {
  const { comment, mine, onEdit, onDelete } = props;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <li className="comment-item">
      <p className="comment-meta">
        <span className="comment-author">{comment.author.name}</span>{" "}
        <time dateTime={new Date(comment.created).toISOString()}>
          {when.format(comment.created)}
        </time>
        {comment.edited === undefined ? null : ` ${t("commentEdited")}`}
      </p>
      {editing ? (
        <CommentBox
          label={t("editComment")}
          action={t("save")}
          initial={comment.body}
          autoFocus
          onSubmit={(body) => {
            onEdit(body);
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : (
        <p className="comment-body">{comment.body}</p>
      )}
      {mine && !editing ? (
        <div className="comment-actions">
          {deleting ? (
            <>
              <button type="button" className="comment-action danger" onClick={onDelete}>
                {t("deleteCommentConfirm")}
              </button>
              <button
                type="button"
                className="comment-action"
                onClick={() => {
                  setDeleting(false);
                }}
              >
                {t("cancel")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="comment-action"
                onClick={() => {
                  setEditing(true);
                }}
              >
                {t("edit")}
              </button>
              <button
                type="button"
                className="comment-action"
                onClick={() => {
                  setDeleting(true);
                }}
              >
                {t("deleteComment")}
              </button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ThreadItem(props: {
  readonly comments: OpenComments;
  readonly thread: CommentThread;
  readonly me: CommentAuthor;
  readonly canComment: boolean;
  readonly active: boolean;
  readonly onActivate: () => void;
}) {
  const { comments, thread, me, canComment, active, onActivate } = props;
  const { document } = comments;
  return (
    <li
      className={active ? "comment-thread active" : "comment-thread"}
      data-thread={thread.id}
      aria-label={t("threadOn", { quote: thread.anchor.quote })}
    >
      <div className="comment-thread-head">
        <button
          type="button"
          className="comment-quote"
          aria-current={active ? "true" : undefined}
          title={t("showInNote")}
          onClick={onActivate}
        >
          {thread.anchor.quote}
        </button>
        {canComment ? (
          <button
            type="button"
            className="comment-action"
            onClick={() => {
              if (thread.resolved === undefined) resolveThread(document, thread.id, me);
              else reopenThread(document, thread.id);
            }}
          >
            {thread.resolved === undefined ? t("resolveThread") : t("reopenThread")}
          </button>
        ) : null}
      </div>
      <ol className="comment-list">
        {thread.comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            mine={canComment && comment.author.id === me.id}
            onEdit={(body) => {
              editComment(document, thread.id, comment.id, body);
            }}
            onDelete={() => {
              deleteComment(document, thread.id, comment.id);
            }}
          />
        ))}
      </ol>
      {thread.resolved === undefined ? null : (
        <p className="comment-resolved">{t("resolvedBy", { name: thread.resolved.by.name })}</p>
      )}
      {canComment && thread.resolved === undefined ? (
        <CommentBox
          label={t("replyToThread")}
          action={t("reply")}
          onSubmit={(body) => {
            reply(document, thread.id, me, body);
          }}
        />
      ) : null}
    </li>
  );
}

export function CommentsPanel(props: {
  readonly comments: OpenComments;
  /** Who this person is, as their comments name them. */
  readonly me: CommentAuthor;
  /** Whether this person may comment on the note, or only read its comments. */
  readonly canComment: boolean;
  /** The thread shown in the note, and the way to show another. */
  readonly active: string | undefined;
  readonly onActivate: (thread: string) => void;
  /** The text a new thread is being written on, while it is. */
  readonly draft: CommentAnchor | undefined;
  readonly onDraftDone: () => void;
  /** The shortcut that comments on the selection, for the hint. */
  readonly commentKeys: string | undefined;
}) {
  const { comments, me, canComment, active, onActivate, draft, onDraftDone, commentKeys } = props;
  const open = comments.threads.filter((thread) => thread.resolved === undefined);
  const resolved = comments.threads.filter((thread) => thread.resolved !== undefined);
  const list = useRef<HTMLElement>(null);

  // The active thread comes into view, as when its text is clicked in the note.
  useEffect(() => {
    if (active === undefined) return;
    list.current
      ?.querySelector(`[data-thread="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const item = (thread: CommentThread) => (
    <ThreadItem
      key={thread.id}
      comments={comments}
      thread={thread}
      me={me}
      canComment={canComment}
      active={thread.id === active}
      onActivate={() => {
        onActivate(thread.id);
      }}
    />
  );

  return (
    <section aria-labelledby="comments-title" className="comments-panel" ref={list}>
      <h2 id="comments-title">{t("comments")}</h2>
      {draft === undefined || !canComment ? null : (
        <div className="comment-thread new" role="group" aria-label={t("newThread")}>
          <p className="comment-quote">{draft.quote}</p>
          <CommentBox
            label={t("writeComment")}
            action={t("postComment")}
            autoFocus
            onSubmit={(body) => {
              onActivate(startThread(comments.document, draft, me, body));
              onDraftDone();
            }}
            onCancel={onDraftDone}
          />
        </div>
      )}
      {open.length === 0 && draft === undefined ? (
        <p className="placeholder">
          {canComment
            ? commentKeys === undefined
              ? t("noCommentsHint")
              : t("noCommentsKeys", { keys: commentKeys })
            : t("noComments")}
        </p>
      ) : (
        <ul className="comment-threads">{open.map(item)}</ul>
      )}
      {resolved.length === 0 ? null : (
        <details className="comment-resolved-threads">
          <summary>{t("resolvedThreads", { count: resolved.length })}</summary>
          <ul className="comment-threads">{resolved.map(item)}</ul>
        </details>
      )}
    </section>
  );
}
