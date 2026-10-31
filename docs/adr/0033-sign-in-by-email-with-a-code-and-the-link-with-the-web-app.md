# 0033. Sign in by email with a code now, and with a link once the web app can open one

- Status: Accepted
- Date: 2026-10-31

## Context

The roadmap's accounts item asks for magic links beside passwords and
OIDC. [ADR 0032](0032-sessions-are-bearer-tokens-and-accounts-come-by-invitation.md)
gave the server sessions and password sign-in. Signing in by email needs
two things the server lacks:

- **A way to send email.** The requirements name the admin's SMTP server
  for notifications, and nothing else: no vendor's mail API, and no email
  at all when the admin sets none, as on an air-gapped network.
- **Somewhere for a link to land.** A link in an email opens a browser.
  Nether's web app, which the server will serve, arrives later in Phase 3.
  The desktop app is not a web page a link can open, and has no address
  of its own to open.

## Decision

**The server sends email through the admin's SMTP server, with
nodemailer.**

- `NETHER_SMTP_URL` names the server, as `smtp://user:password@host:587`
  (STARTTLS when offered) or `smtps://…:465`.
- `NETHER_MAIL_FROM` names the sender, and must be set with it.
- Without them the server sends no email, and offers nothing that needs
  it. `GET /api/sign-in-methods` tells the app which ways to sign in it
  can offer.
- Messages are plain text, which every client shows as written.
- `Mailer` is a small interface, so the notifications of comments and
  mentions send through it too, and tests use their own.

**Signing in by email sends a code of eight digits.**

- `POST /api/sign-in-codes` with an address answers 202 with the same
  words whether or not it has an account. The code is made and sent after
  the answer, so its time does not tell either.
- For an address with an account, the code is emailed, in the subject too
  for a notification to show it, with the account's name.
- `POST /api/sign-in-codes/redeem` with the address and the code starts a
  session. It is redeemed as typed: spaces and dashes are ignored.
- A code works once, within 15 minutes, for that address only. Five wrong
  tries spend it, and asking again replaces it.
- Only its SHA-256 is kept.
- One address gets at most three emails in 15 minutes, however many ask.
  Each client address may ask ten times in 15 minutes, and redeem 30 times
  in five.

**The link comes with the web app.**

- The web app's pull request adds a link to the same email: the server's
  public address with a token in the URL's fragment, which browsers do not
  send to servers or keep in logs.
- Opening it signs the browser in. The code stays for the desktop and
  mobile apps, and for a link opened on another device than the one
  signing in.

## Alternatives

- **A link now, to a page the server renders until the web app exists.**
  A page that only takes a token and shows "signed in" signs no app in.
  The desktop app would need a custom URL scheme registered on every
  system, or a server on a loopback port the link could reach. Both are
  more surface than a code, for a page the web app replaces.
- **A link only, never a code.** A link signs in the browser that opens
  it, which is often a phone's mail app, not the device signing in.
- **Six digits.** Common, but with five tries, eight digits make a guess
  100 times less likely, at the cost of two keystrokes.
- **A vendor's mail API (SES, Postmark, Mailgun).** Nether may not depend
  on a vendor. Every one of them, and every self-hosted mail server, speaks
  SMTP.
- **Sending before answering.** The answer would be slower when an account
  exists, telling which addresses have one.

## Consequences

- An admin who wants sign-in by email, and later the notifications, sets
  two variables, and mail failures show in the server's log, not to the
  person asking.
- A code's hash, eight digits, could be found by trying them all from a
  copy of the database; the code is then spent or expired within 15
  minutes.
- The web app's pull request adds the link and the page it opens, and
  then the accounts item's magic links are complete.
- The server's emails are in English until the server's strings are
  translated, with the notifications.
