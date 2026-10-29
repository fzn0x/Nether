# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it
privately through GitHub's
[private vulnerability reporting](https://github.com/fzn0x/nether/security/advisories/new)
instead.

Include what an attacker can do, the steps to reproduce it, the part of
Nether it affects (desktop app, server, web app), its version or commit,
and your operating system. You should get an answer within a week. Once a
fix is released, the advisory is published with credit to you, unless you
prefer otherwise.

## Supported versions

Nether has no release yet, so fixes go to `main`. Once it has releases,
fixes go into the latest one; please check that a problem still happens
there before reporting it.

## What counts

These are in scope as the code that handles them arrives:

- On the server: getting past sign-in, reading or changing notes,
  workspaces or settings without access to them, cross-site scripting in
  the web app, server-side request forgery, and injection of any kind.
- In sync: the server learning the content of an end-to-end encrypted
  vault, or a client accepting updates another party forged.
- In the desktop app: a note, a vault or a link that makes the app read or
  write files outside the vault, run code, or reach the network without
  the user asking it to.
- A plugin escaping its sandbox or using permissions the user did not
  grant.
- Getting around single sign-on, provisioning or audit logs when those
  enterprise features are on.
- Passwords, tokens or AI provider keys written to logs, exports or synced
  data.

These are not vulnerabilities on their own:

- Someone with access to your user account, or to your server, reading
  your notes.
- A plugin you approved doing what the permissions it declared allow.
