# 0034. Sign in with OpenID Connect through the server, and hand the session back to the app

- Status: Accepted
- Date: 2026-10-31

## Context

The accounts item of the roadmap ends with OIDC. Teams that self-host
often have a provider already, such as Keycloak, Authentik, Okta,
Microsoft Entra ID or Google, and want people to sign in with it.

- **Enforced login is an enterprise feature.** The requirements make
  enforced SSO an enterprise feature (SAML and OIDC that must be used).
  Signing in with OIDC as one choice among others is a community feature.
- **The desktop app is not a browser.** It cannot receive the provider's
  redirect itself, and a token must not travel through a browser's address
  bar, history or logs. RFC 8252 describes how native apps do this: the
  system browser, a redirect to a loopback address the app listens on,
  and PKCE.
- **The server holds the client secret.** The provider knows the server
  as its client, with a redirect address on the server's public address
  and, usually, a secret only the server may hold. Many providers accept
  only https redirect addresses that an admin registers once.
- **Accounts come by invitation**
  ([ADR 0032](0032-sessions-are-bearer-tokens-and-accounts-come-by-invitation.md)),
  and an invited person should be able to join with the provider.

## Decision

**The server is the provider's client, with openid-client (MIT).** The
admin sets:

| Variable | What it holds |
| --- | --- |
| `NETHER_OIDC_ISSUER` | The provider's issuer, whose discovery document is read once and read again after a failure |
| `NETHER_OIDC_CLIENT_ID`, `NETHER_OIDC_CLIENT_SECRET` | The client's credentials; without a secret, a public client that proves itself with PKCE alone |
| `NETHER_OIDC_NAME` | The provider's name, for the app's button |
| `NETHER_PUBLIC_URL` | The server's own address. The provider sends people back to `NETHER_PUBLIC_URL/api/oidc/callback`, which the admin registers |

The server asks for `openid email profile`, with its own PKCE, a state and
a nonce, all checked by openid-client.

**The app and the server meet through a handoff, as RFC 8252 describes.**

1. The app asks for a flow (`POST /api/oidc/flows`), naming:
   - where the browser should come back to: a loopback address by IP
     (`http://127.0.0.1:port/…` or `http://[::1]:port/…`), never
     `localhost`, which a hosts file can point elsewhere; or an address on
     the server's own origin, for the web app;
   - a PKCE challenge of its own;
   - optionally, an invitation's token, in the body.

   It opens the provider's address that it gets back in the system
   browser.
2. The provider sends the browser to the server's callback. The server
   redeems the provider's code, checks the ID token, and finds the
   account.
3. The server sends the browser back to the app's address with a code
   that lasts a minute, or with an `error`:

   | `error` | Why |
   | --- | --- |
   | `access_denied` | The person cancelled at the provider |
   | `no_account` | No account, and sign-up is off |
   | `email_not_verified` | The provider has not verified the address |
   | `invitation` | The invitation was used, withdrawn or has expired |
   | `other_address` | The invitation is for another address |
   | `provider_error` | The provider's answer was refused |

4. The app redeems the code with its PKCE verifier
   (`POST /api/oidc/redeem`) for a session, as signing in with a password
   gives. A code is spent by any try, right or wrong.

The browser carries only codes that are useless alone: the provider's,
which needs the server's secret and verifier, and the server's, which
needs the app's verifier.

**The account is found by the identity, then by a verified address.**

- An identity (the issuer and the subject the provider names) once linked
  to an account signs in to it, whatever address the provider gives later.
- An identity not linked yet is linked to the account whose address the
  provider says it has verified (`email_verified`). An address it has not
  verified is refused, since anyone could claim one.
- Otherwise:
  - with an invitation, the account is made, and the invitation must be
    for that address if it names one;
  - with `NETHER_OIDC_SIGN_UP=on`, anyone the provider signs in gets an
    account, as a team with its own provider may want;
  - otherwise the answer is `no_account`.
- Accounts made this way have no password; their owners sign in with the
  provider or by email.

**A provider over plain HTTP is allowed when the admin names one.** An
issuer given as `http://` is used, with a warning in the log, for a
provider on the same private network such as Keycloak beside the server.
openid-client refuses plain HTTP unless told otherwise, and marks that
switch deprecated so it stands out. Nether's one lint exception is that
line.

`GET /api/sign-in-methods` names the provider, so the app can offer it.

## Alternatives

- **The app as the provider's client, without the server.** The secret
  would ship in every app, and every app's loopback address would need
  registering with the provider.
- **A custom URL scheme (`nether://`) for coming back.** It needs
  registering on every system, any app may claim it, and RFC 8252 prefers
  loopback for desktop apps. Mobile apps may add claimed https links when
  they come.
- **The session token in the redirect.** It would sit in the browser's
  history, and any process able to read the loopback request could use
  it.
- **Linking by any address, verified or not.** Some providers let people
  type any address, which would let them sign in to another's account.
- **Sign-up on by default.** It would make the server open to everyone a
  public provider such as Google signs in.
- **Requiring https for every provider.** Air-gapped and small installs
  often run their provider on the private network without TLS; refusing
  them would push those admins to weaker workarounds.

## Consequences

- An admin registers one redirect address with the provider and sets four
  variables; people then sign in from any of Nether's apps.
- The desktop app's sign-in, with the sync pull request, listens on a
  loopback port for the duration of a sign-in.
- Enforced OIDC and SAML, which the enterprise SSO module adds, can reuse
  the flow, the identities and the handoff.
- Revisit linking by address if a provider is found to mark addresses
  verified without verifying them; a setting could then turn linking off.
