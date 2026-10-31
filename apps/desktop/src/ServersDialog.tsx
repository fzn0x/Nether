// The servers the app is signed in to, and signing in to another (ADR
// 0036): its address, then a password, a code it emails, or its OpenID
// Connect provider in the system's browser, as the server offers. A
// session's token goes to the system's keychain; signing out ends the
// session on the server, and forgets it here either way. Each account's
// end-to-end encryption (ADR 0038) is turned on here, showing its recovery
// phrase once, or unlocked on a new device with the phrase. Someone invited
// to a workspace joins here with the invitation's link, into the account
// they are signed in to on its server, or a new one.
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { backend } from "./backend.ts";
import type { PreparedKeys } from "./encryption.ts";
import { t } from "./messages.ts";
import type { ServerAccount } from "./mygo.ts";
import {
  type InvitationOffer,
  type LoopbackWait,
  type SignInMethods,
  type SignedIn,
  acceptInvitation,
  accountKeys,
  askForCode,
  lookUpInvitation,
  readInvitationLink,
  redeemCode,
  serverAddress,
  signInMethods,
  signInWithPassword,
  signInWithProvider,
  signOut,
} from "./server.ts";
import { useModal } from "./useModal.ts";

type Step =
  | { readonly kind: "list" }
  | { readonly kind: "address" }
  | { readonly kind: "signIn"; readonly url: string; readonly methods: SignInMethods }
  | {
      readonly kind: "code";
      readonly url: string;
      readonly methods: SignInMethods;
      readonly email: string;
    }
  | { readonly kind: "keys"; readonly account: ServerAccount; readonly keys: PreparedKeys }
  | { readonly kind: "unlock"; readonly account: ServerAccount }
  | { readonly kind: "join" }
  | {
      readonly kind: "joining";
      readonly url: string;
      readonly token: string;
      readonly offer: InvitationOffer;
      /** The account this app is signed in to on that server, which joins; none makes one. */
      readonly account: ServerAccount | undefined;
    };

/** An account's end-to-end encryption: not turned on, on but not on this device, or on here. */
type Encryption = "off" | "locked" | "on";

/** Each account's encryption, as the server and this device's keychain tell it. */
async function encryptionOf(
  accounts: readonly ServerAccount[],
): Promise<ReadonlyMap<string, Encryption>> {
  const found = new Map<string, Encryption>();
  for (const account of accounts) {
    try {
      if ((await backend.serverKey(account.url)) !== undefined) {
        found.set(account.url, "on");
        continue;
      }
      const token = await backend.serverToken(account.url);
      if (token === undefined) continue;
      const keys = await accountKeys(backend.serverFetch, account.url, token);
      found.set(account.url, keys === undefined ? "off" : "locked");
    } catch {
      // A server that cannot be reached shows no encryption until it can.
    }
  }
  return found;
}

/** A server's address as the dialog shows it: its host, and port if any. */
function hostOf(url: string): string {
  return new URL(url).host;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ServersDialog(props: { readonly onClose: () => void }) {
  const { onClose } = props;
  const [accounts, setAccounts] = useState<readonly ServerAccount[] | undefined>();
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [phrase, setPhrase] = useState("");
  const [invitation, setInvitation] = useState("");
  const [name, setName] = useState("");
  const [written, setWritten] = useState(false);
  const [encryption, setEncryption] = useState<ReadonlyMap<string, Encryption>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  /** A sign-in in the system's browser, while the app waits for it to come back. */
  const [browser, setBrowser] = useState<LoopbackWait | undefined>();
  const waiting = useRef<LoopbackWait | undefined>(undefined);
  const cancelled = useRef(false);
  // Read through a function: the Cancel button changes it while a sign-in waits.
  const wasCancelled = () => cancelled.current;
  const dialog = useRef<HTMLFormElement>(null);
  useModal(dialog);

  // Each step starts at its main control: the field to fill, or Done.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [step.kind, accounts]);

  useEffect(() => {
    let current = true;
    // Read through a function: the cleanup changes it during the waits.
    const live = () => current;
    void backend.servers().then(async (list) => {
      if (!live()) return;
      setAccounts(list);
      // With no server yet, the dialog starts at the address.
      if (list.length === 0) setStep({ kind: "address" });
      const found = await encryptionOf(list);
      if (live()) setEncryption(found);
    });
    return () => {
      current = false;
      // A sign-in still waiting for the browser stops when the dialog closes.
      void waiting.current?.close();
    };
  }, []);

  /** Runs an action, showing it busy, and its failure. */
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await action();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    const list = await backend.servers();
    setAccounts(list);
    setEncryption(await encryptionOf(list));
  };

  const finish = async (url: string, signedIn: SignedIn) => {
    await backend.saveServer({ url, user: signedIn.user }, signedIn.token);
    await refresh();
    setPassword("");
    setCode("");
    setStep({ kind: "list" });
    setStatus(t("signedInTo", { server: hostOf(url), name: signedIn.user.name }));
  };

  const submit = () => {
    if (busy) return;
    if (step.kind === "list") {
      onClose();
    } else if (step.kind === "address") {
      const url = serverAddress(address);
      if (url === undefined) {
        setError(t("serverAddressInvalid"));
        return;
      }
      void act(async () => {
        setStep({ kind: "signIn", url, methods: await signInMethods(backend.serverFetch, url) });
      });
    } else if (step.kind === "signIn") {
      void act(async () => {
        await finish(
          step.url,
          await signInWithPassword(backend.serverFetch, step.url, email, password),
        );
      });
    } else if (step.kind === "code") {
      void act(async () => {
        await finish(step.url, await redeemCode(backend.serverFetch, step.url, step.email, code));
      });
    } else if (step.kind === "join") {
      const found = readInvitationLink(invitation);
      if (found === undefined) {
        setError(t("invitationLinkInvalid"));
        return;
      }
      void act(async () => {
        const offer = await lookUpInvitation(backend.serverFetch, found.server, found.token);
        if (offer.email !== null) setEmail(offer.email);
        setStep({
          kind: "joining",
          url: found.server,
          token: found.token,
          offer,
          account: accounts?.find((account) => account.url === found.server),
        });
      });
    } else if (step.kind === "joining") {
      void act(async () => {
        const { url, offer, account } = step;
        if (account === undefined) {
          const signedIn = await acceptInvitation(backend.serverFetch, url, step.token, {
            name,
            email,
            password,
          });
          if (signedIn !== undefined) await finish(url, signedIn);
        } else {
          const session = await backend.serverToken(url);
          if (session === undefined) throw new Error(t("syncSignedOut", { server: hostOf(url) }));
          await acceptInvitation(backend.serverFetch, url, step.token, { session });
          await refresh();
          setStep({ kind: "list" });
        }
        setInvitation("");
        setStatus(t("invitationJoined", { workspace: offer.workspace.name }));
      });
    } else if (step.kind === "keys") {
      if (!written) return;
      void act(async () => {
        const server = step.account.url;
        const token = await backend.serverToken(server);
        if (token === undefined) throw new Error(t("syncSignedOut", { server: hostOf(server) }));
        const { keepKeys } = await import("./encryption.ts");
        await keepKeys(server, token, step.keys);
        await refresh();
        setStep({ kind: "list" });
        setStatus(t("encryptionTurnedOn", { server: hostOf(server) }));
      });
    } else {
      void act(async () => {
        const server = step.account.url;
        const token = await backend.serverToken(server);
        if (token === undefined) throw new Error(t("syncSignedOut", { server: hostOf(server) }));
        const { unlockKeys } = await import("./encryption.ts");
        await unlockKeys(server, token, step.account.user.id, phrase);
        setPhrase("");
        await refresh();
        setStep({ kind: "list" });
        setStatus(t("encryptionUnlocked", { server: hostOf(server) }));
      });
    }
  };

  const turnOn = (account: ServerAccount) => {
    void act(async () => {
      // The keys are made here, and kept only once the phrase is written down.
      const { prepareKeys } = await import("./encryption.ts");
      setWritten(false);
      setStep({ kind: "keys", account, keys: await prepareKeys(account.user.id) });
    });
  };

  const signOutOf = (account: ServerAccount) => {
    void act(async () => {
      const token = await backend.serverToken(account.url);
      // The session ends on the server if it can be reached; here, either way.
      if (token !== undefined)
        await signOut(backend.serverFetch, account.url, token).catch(() => undefined);
      await backend.forgetServer(account.url);
      await refresh();
      setStatus(t("signedOutOf", { server: hostOf(account.url) }));
    });
  };

  const emailCode = (url: string, methods: SignInMethods) => {
    void act(async () => {
      await askForCode(backend.serverFetch, url, email);
      setStep({ kind: "code", url, methods, email: email.trim() });
    });
  };

  const withProvider = (url: string) => {
    void act(async () => {
      const loopback = await backend.loopback();
      waiting.current = loopback;
      cancelled.current = false;
      setBrowser(loopback);
      setStatus(t("waitingForBrowser"));
      try {
        await finish(
          url,
          await signInWithProvider(backend.serverFetch, url, loopback, (target) =>
            backend.openUrl(target),
          ),
        );
      } catch (reason) {
        // Cancelled here, by the Cancel button: nothing went wrong.
        if (!wasCancelled()) throw reason;
        setStatus(undefined);
      } finally {
        waiting.current = undefined;
        setBrowser(undefined);
      }
    });
  };

  /** An account's encryption, and the way to turn it on or unlock it here. */
  const encryptionLine = (account: ServerAccount) => {
    const state = encryption.get(account.url);
    if (state === undefined) return null;
    const hint =
      state === "on"
        ? t("encryptionOnHint")
        : state === "locked"
          ? t("encryptionLockedHint")
          : t("encryptionOffHint");
    return (
      <>
        <span className="hint">{hint}</span>
        {state === "off" ? (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => {
              turnOn(account);
            }}
          >
            {t("encryptionTurnOn")}
          </button>
        ) : state === "locked" ? (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => {
              setError(undefined);
              setPhrase("");
              setStep({ kind: "unlock", account });
            }}
          >
            {t("encryptionUnlock")}
          </button>
        ) : null}
      </>
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  let body: ReactNode;
  let primary: string;
  let back: Step | undefined;
  if (step.kind === "list") {
    primary = t("done");
    body = (
      <>
        {accounts === undefined || accounts.length === 0 ? (
          <p className="hint">{t("serversNone")}</p>
        ) : (
          <ul className="server-list" aria-label={t("servers")}>
            {accounts.map((account) => (
              <li key={account.url}>
                <span>
                  <strong>{hostOf(account.url)}</strong>{" "}
                  {t("serverAccount", { name: account.user.name, email: account.user.email })}
                </span>
                {encryptionLine(account)}
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    signOutOf(account);
                  }}
                >
                  {t("signOutOf", { server: hostOf(account.url) })}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => {
            setError(undefined);
            setStatus(undefined);
            setStep({ kind: "address" });
          }}
        >
          {t("connectServer")}
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => {
            setError(undefined);
            setStatus(undefined);
            setStep({ kind: "join" });
          }}
        >
          {t("invitationJoin")}
        </button>
      </>
    );
  } else if (step.kind === "join") {
    primary = t("continueStep");
    back = accounts === undefined || accounts.length === 0 ? { kind: "address" } : { kind: "list" };
    body = (
      <label className="field">
        {t("invitationLink")}
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          required
          data-autofocus
          value={invitation}
          aria-describedby="invitation-link-hint"
          onChange={(event) => {
            setInvitation(event.target.value);
          }}
        />
        <span id="invitation-link-hint" className="hint">
          {t("invitationLinkHint")}
        </span>
      </label>
    );
  } else if (step.kind === "joining") {
    const { url, offer, account } = step;
    primary =
      account === undefined
        ? t("invitationMakeAccount")
        : t("invitationJoinAs", { name: account.user.name });
    back = { kind: "join" };
    body = (
      <>
        <p>
          {t("invitationTo", {
            workspace: offer.workspace.name,
            server: hostOf(url),
            role: t(`role_${offer.role}`),
          })}
          {offer.invitedBy === null ? null : ` ${t("invitationFrom", { name: offer.invitedBy })}`}
        </p>
        {account === undefined ? (
          <fieldset>
            <legend>{t("invitationNewAccount", { server: hostOf(url) })}</legend>
            <label className="field">
              {t("yourName")}
              <input
                type="text"
                autoComplete="name"
                required
                data-autofocus
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <label className="field">
              {t("emailAddress")}
              <input
                type="email"
                autoComplete="username"
                required
                readOnly={offer.email !== null}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </label>
            <label className="field">
              {t("password")}
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                aria-describedby="new-password-hint"
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
              <span id="new-password-hint" className="hint">
                {t("newPasswordHint")}
              </span>
            </label>
            <p className="hint">{t("invitationHaveAccount", { server: hostOf(url) })}</p>
          </fieldset>
        ) : null}
      </>
    );
  } else if (step.kind === "keys") {
    primary = t("encryptionTurnOn");
    back = { kind: "list" };
    body = (
      <>
        <p>{t("recoveryPhraseIntro")}</p>
        <ol className="recovery-phrase" aria-label={t("recoveryPhrase")}>
          {step.keys.phrase.split(" ").map((word, index) => (
            <li key={index}>{word}</li>
          ))}
        </ol>
        <p className="hint">{t("recoveryPhraseWarning")}</p>
        <label className="field-check">
          <input
            type="checkbox"
            data-autofocus
            checked={written}
            onChange={(event) => {
              setWritten(event.target.checked);
            }}
          />
          {t("recoveryPhraseWritten")}
        </label>
      </>
    );
  } else if (step.kind === "unlock") {
    primary = t("encryptionUnlock");
    back = { kind: "list" };
    body = (
      <label className="field">
        {t("recoveryPhrase")}
        <textarea
          rows={4}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          required
          data-autofocus
          value={phrase}
          aria-describedby="recovery-phrase-hint"
          onChange={(event) => {
            setPhrase(event.target.value);
          }}
        />
        <span id="recovery-phrase-hint" className="hint">
          {t("recoveryPhraseUnlockHint")}
        </span>
      </label>
    );
  } else if (step.kind === "address") {
    primary = t("continueStep");
    back = accounts === undefined || accounts.length === 0 ? undefined : { kind: "list" };
    body = (
      <label className="field">
        {t("serverAddress")}
        <input
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          required
          data-autofocus
          value={address}
          aria-describedby="server-address-hint"
          onChange={(event) => {
            setAddress(event.target.value);
          }}
        />
        <span id="server-address-hint" className="hint">
          {t("serverAddressHint")}
        </span>
      </label>
    );
    body = (
      <>
        {body}
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => {
            setError(undefined);
            setStatus(undefined);
            setStep({ kind: "join" });
          }}
        >
          {t("invitationJoin")}
        </button>
      </>
    );
  } else if (step.kind === "signIn") {
    const { url, methods } = step;
    primary = t("signIn");
    back = { kind: "address" };
    body = (
      <fieldset>
        <legend>{t("signInTo", { server: hostOf(url) })}</legend>
        {methods.password || methods.emailCode ? (
          <label className="field">
            {t("emailAddress")}
            <input
              type="email"
              autoComplete="username"
              required
              data-autofocus
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </label>
        ) : null}
        {methods.password ? (
          <label className="field">
            {t("password")}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </label>
        ) : null}
        {methods.emailCode ? (
          <button
            type="button"
            className="quiet"
            disabled={busy || email.trim() === ""}
            onClick={() => {
              emailCode(url, methods);
            }}
          >
            {t("emailMeCode")}
          </button>
        ) : null}
        {methods.oidc === null ? null : (
          <button
            type="button"
            // The main way in when the server takes no password or code.
            className={methods.password || methods.emailCode ? "quiet" : "primary"}
            disabled={busy}
            {...(methods.password || methods.emailCode ? {} : { "data-autofocus": true })}
            onClick={() => {
              withProvider(url);
            }}
          >
            {t("signInWith", { name: methods.oidc.name })}
          </button>
        )}
      </fieldset>
    );
  } else {
    primary = t("signIn");
    back = { kind: "signIn", url: step.url, methods: step.methods };
    body = (
      <>
        <p>{t("codeSent", { email: step.email })}</p>
        <label className="field">
          {t("signInCode")}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            data-autofocus
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
        </label>
      </>
    );
  }
  // Only a password signs in with the main button; a server without one
  // offers its other ways as their own buttons.
  const showPrimary = step.kind !== "signIn" || step.methods.password;

  return (
    <div
      className="switcher-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="switcher dialog settings-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="servers-title"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={onKeyDown}
      >
        <h2 id="servers-title">{t("servers")}</h2>
        {/* Nothing shows until the servers signed in to are known. */}
        <div className="dialog-body">{accounts === undefined ? null : body}</div>
        <p role="status">{status}</p>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          {back === undefined ? null : (
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                setError(undefined);
                setStep(back);
              }}
            >
              {t("back")}
            </button>
          )}
          {browser === undefined ? null : (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                cancelled.current = true;
                void browser.close();
              }}
            >
              {t("cancel")}
            </button>
          )}
          {showPrimary ? (
            <button
              type="submit"
              className="primary"
              disabled={busy || (step.kind === "keys" && !written)}
              {...(step.kind === "list" ? { "data-autofocus": true } : {})}
            >
              {primary}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
