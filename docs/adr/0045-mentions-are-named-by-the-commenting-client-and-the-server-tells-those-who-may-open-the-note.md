# 0045. Mentions are named by the commenting client, and the server tells those who may open the note

- Status: Accepted
- Date: 2026-10-31

## Context

The [requirements](../requirements.md#collaboration) ask for mentions and
notifications: "`@person` notifies them in-app and by email (SMTP
configured by admin)".

Comments are a Yjs document beside each note
([ADR 0044](0044-a-notes-comments-are-a-document-of-their-own-beside-it.md)).
The server stores that document but cannot see who a comment mentions in
an encrypted workspace, where it holds ciphertext alone. Even where it can
read it, it would have to diff each stored document to find the mentions
that are new.

A mention could also go in a note's text. That needs a Markdown syntax for
a person, which other apps would show as it is, and so a change to the
vault's file format.

## Decision

**People are mentioned in comments, and the client names them.** When
someone sends a comment that mentions people, their app posts the
mention to the server:
`POST /api/workspaces/:workspace/notifications` with the note, the thread
and the people, and, for a workspace the server can read, the note's
title and the comment as an excerpt.

**The server checks before it tells anyone.**

- The sender must be a member who may comment on the note: comment
  level or more on its unit
  ([ADR 0042](0042-spaces-and-shared-pages-are-sync-units-each-with-its-own-vault-document.md)).
- Each person named is told only if they may open the note's unit, at
  any level. Others are skipped without a word, so a mention reveals
  nothing to anyone who cannot already read the note. The sender is never
  told of their own mention.
- An encrypted workspace's mentions carry no text: the server refuses a
  title or an excerpt there, so a client cannot leak them by mistake.
- At most 20 people per mention, and 60 mentions per account every 10
  minutes.

**Notifications are kept for each person, and emailed.** Each is a row in
`notifications`: who was told, by whom, in which workspace, about which
note and thread, with the title and excerpt if any, and when it was read.
`GET /api/notifications` lists the latest 50 and the unread count, from
the workspaces the person is still in, and `POST /api/notifications/read`
marks some or all of them read. When the admin has configured SMTP, the
server also emails each person told, unless they turned that off
(`PUT /api/me/notification-settings`). An encrypted workspace's email
says only that someone mentioned them in a note there. Notifications are
deleted after 90 days.

## Alternatives

- **The server finds mentions in stored comments.** It cannot in an
  encrypted workspace, and elsewhere it would need to compare each stored
  comments document with the last to find which mentions are new.
- **Mentions in a note's text.** These need a Markdown form for a person.
  That changes the vault's file format, so it needs a decision of its own,
  later.
- **Notifications through sync.** A notification is for one person, across
  workspaces, while sync documents belong to a workspace's units. A table
  and a list for each account fit better.

## Consequences

- Mentions work the same in encrypted workspaces, without the server
  reading anything it could not before.
- A client could post mentions no comment holds. The server's checks
  limit that to people who may open the note anyway, at a limited rate.
- A mention made offline is posted when the app is back online.
- Mentions in a note's text, and other kinds of notifications, can join
  later as new kinds.
