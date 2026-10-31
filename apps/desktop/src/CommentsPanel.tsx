// A note's comments, beside it (ADR 0044): a thread for each range of its
// text commented on, the oldest first, each with its comments, a reply box
// and a button that resolves or reopens it. Resolved threads fold away
// under a heading of their own. Each person edits and deletes their own
// comments; those who may only view read them. Typing @ in a comment offers
// the workspace's people to mention, who are told of it (ADR 0045).
import {
  type CommentAnchor,
  type CommentAuthor,
  type CommentThread,
  type NoteComment,
  deleteComment,
  editComment,
  mentionedIn,
  reopenThread,
  reply,
  resolveThread,
  startThread,
} from "@nether/editor";
import { type SyntheticEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "./messages.ts";
import type { OpenComments } from "./useComments.ts";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** How many people the picker offers at once. */
const offered = 6;

/** The `@` being typed before the caret, and where it starts; undefined when none is. */
function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(text.slice(0, caret));
  const query = match?.[1];
  return query === undefined ? undefined : { start: caret - query.length - 1, query };
}

/** The people a word of whose name starts with what was typed, which has no spaces. */
function matching(people: readonly CommentAuthor[], query: string): CommentAuthor[] {
  const typed = query.toLowerCase();
  return people
    .filter((person) =>
      person.name
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(typed)),
    )
    .slice(0, offered);
}

/**
 * A box to write a comment in: Ctrl or Cmd and Enter sends it, Escape gives
 * up. Typing @ offers the people to mention: arrows choose, Enter or Tab
 * picks, and Escape closes the list.
 */
function CommentBox(props: {
  readonly label: string;
  readonly action: string;
  readonly initial?: string;
  readonly initialMentions?: readonly CommentAuthor[];
  readonly autoFocus?: boolean;
  readonly people: readonly CommentAuthor[];
  readonly onSubmit: (body: string, mentions: readonly CommentAuthor[]) => void;
  readonly onCancel?: (() => void) | undefined;
}) {
  const {
    label,
    action,
    initial = "",
    initialMentions = [],
    autoFocus = false,
    people,
    onSubmit,
    onCancel,
  } = props;
  const [body, setBody] = useState(initial);
  const [picked, setPicked] = useState<readonly CommentAuthor[]>(initialMentions);
  const [typing, setTyping] = useState<{ start: number; query: string } | undefined>();
  const [choice, setChoice] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const matches = typing === undefined ? [] : matching(people, typing.query);
  const open = matches.length > 0;

  const submit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (text === "") return;
    onSubmit(text, mentionedIn(text, picked));
    setBody("");
    setPicked([]);
    setTyping(undefined);
  };

  const pick = (person: CommentAuthor) => {
    if (typing === undefined) return;
    const end = typing.start + 1 + typing.query.length;
    const inserted = `@${person.name} `;
    const next = body.slice(0, typing.start) + inserted + body.slice(end);
    const caret = typing.start + inserted.length;
    setBody(next);
    setPicked([...picked, person]);
    setTyping(undefined);
    requestAnimationFrame(() => {
      area.current?.setSelectionRange(caret, caret);
    });
  };

  const follow = (element: HTMLTextAreaElement) => {
    setTyping(mentionAt(element.value, element.selectionStart));
    setChoice(0);
  };

  return (
    <form className="comment-box" onSubmit={submit}>
      <textarea
        ref={area}
        aria-label={label}
        placeholder={label}
        value={body}
        rows={2}
        autoFocus={autoFocus}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${String(choice)}` : undefined}
        onChange={(event) => {
          setBody(event.target.value);
          follow(event.target);
        }}
        onClick={(event) => {
          follow(event.currentTarget);
        }}
        onBlur={() => {
          setTyping(undefined);
        }}
        onKeyDown={(event) => {
          if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setChoice((choice + step + matches.length) % matches.length);
          } else if (open && (event.key === "Enter" || event.key === "Tab") && !event.ctrlKey) {
            event.preventDefault();
            const person = matches[choice];
            if (person !== undefined) pick(person);
          } else if (open && event.key === "Escape") {
            event.preventDefault();
            setTyping(undefined);
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape" && onCancel !== undefined) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {open ? (
        <ul className="mention-picker" id={listId} role="listbox" aria-label={t("mentionPeople")}>
          {matches.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${String(index)}`}
              role="option"
              aria-selected={index === choice}
              onMouseDown={(event) => {
                // Picked before the box loses focus, which closes the list.
                event.preventDefault();
                pick(person);
              }}
            >
              {person.name}
            </li>
          ))}
        </ul>
      ) : null}
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

/** A comment's text, each person it mentions marked, this person's own more. */
function CommentText(props: { readonly comment: NoteComment; readonly me: CommentAuthor }) {
  const { comment, me } = props;
  const names = [...comment.mentions].sort((a, b) => b.name.length - a.name.length);
  if (names.length === 0) return <p className="comment-body">{comment.body}</p>;
  const pattern = new RegExp(
    `@(${names.map((person) => person.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  const parts: (string | CommentAuthor)[] = [];
  let last = 0;
  for (const match of comment.body.matchAll(pattern)) {
    const person = names.find((each) => each.name === match[1]);
    if (person === undefined) continue;
    parts.push(comment.body.slice(last, match.index), person);
    last = match.index + match[0].length;
  }
  parts.push(comment.body.slice(last));
  return (
    <p className="comment-body">
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={index} className={part.id === me.id ? "mention me" : "mention"}>
            @{part.name}
          </span>
        ),
      )}
    </p>
  );
}

/** One comment: who wrote it and when, what it says, and, for its writer, edit and delete. */
function CommentItem(props: {
  readonly comment: NoteComment;
  readonly me: CommentAuthor;
  readonly mine: boolean;
  readonly people: readonly CommentAuthor[];
  readonly onEdit: (body: string, mentions: readonly CommentAuthor[]) => void;
  readonly onDelete: () => void;
}) {
  const { comment, me, mine, people, onEdit, onDelete } = props;
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
          initialMentions={comment.mentions}
          autoFocus
          people={people}
          onSubmit={(body, mentions) => {
            onEdit(body, mentions);
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : (
        <CommentText comment={comment} me={me} />
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

/** Tells of the people a comment mentions, but this person. */
type OnMention = (thread: string, people: readonly CommentAuthor[], body: string) => void;

function ThreadItem(props: {
  readonly comments: OpenComments;
  readonly thread: CommentThread;
  readonly me: CommentAuthor;
  readonly canComment: boolean;
  readonly active: boolean;
  readonly people: readonly CommentAuthor[];
  readonly onActivate: () => void;
  readonly onMention: OnMention;
}) {
  const { comments, thread, me, canComment, active, people, onActivate, onMention } = props;
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
            me={me}
            mine={canComment && comment.author.id === me.id}
            people={people}
            onEdit={(body, mentions) => {
              editComment(document, thread.id, comment.id, body, Date.now(), mentions);
              // Only those it mentions anew are told.
              const before = new Set(comment.mentions.map((person) => person.id));
              onMention(
                thread.id,
                mentions.filter((person) => !before.has(person.id)),
                body,
              );
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
          people={people}
          onSubmit={(body, mentions) => {
            reply(document, thread.id, me, body, Date.now(), mentions);
            onMention(thread.id, mentions, body);
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
  /** The people a comment may mention. */
  readonly people?: readonly CommentAuthor[];
  /** Called when a comment mentions people, to tell them. */
  readonly onMention?: OnMention | undefined;
}) {
  const {
    comments,
    me,
    canComment,
    active,
    onActivate,
    draft,
    onDraftDone,
    commentKeys,
    people = [],
    onMention,
  } = props;
  const open = comments.threads.filter((thread) => thread.resolved === undefined);
  const resolved = comments.threads.filter((thread) => thread.resolved !== undefined);
  const list = useRef<HTMLElement>(null);
  // This person is not offered to mention, nor told of their own mention.
  const others = people.filter((person) => person.id !== me.id);
  const mentioned: OnMention = (thread, mentions, body) => {
    const told = mentions.filter((person) => person.id !== me.id);
    if (told.length > 0) onMention?.(thread, told, body);
  };

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
      people={others}
      onActivate={() => {
        onActivate(thread.id);
      }}
      onMention={mentioned}
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
            people={others}
            onSubmit={(body, mentions) => {
              const thread = startThread(comments.document, draft, me, body, Date.now(), mentions);
              onActivate(thread);
              onDraftDone();
              mentioned(thread, mentions, body);
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
