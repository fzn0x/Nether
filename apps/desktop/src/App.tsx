import { isMyGo } from "mygo-runtime";
import { Suspense, type SyntheticEvent, lazy, useCallback, useEffect, useState } from "react";
import { Mark } from "./Mark.tsx";
import { VaultView } from "./VaultView.tsx";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import { type AppInfo, Desktop, type ServerAccount, type VaultInfo } from "./mygo.ts";
import { ServerError, type Workspace, makeWorkspace, redeemCode } from "./server.ts";
import { webFetch, webServer, webWorkspaces } from "./web.ts";

const platforms: Partial<Record<string, string>> = {
  darwin: "macOS",
  linux: "Linux",
  windows: "Windows",
};

function Welcome(props: { readonly onOpen: (vault: VaultInfo) => void }) {
  const { onOpen } = props;
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [recent, setRecent] = useState<VaultInfo[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    // Outside the desktop app, as in a browser tab of the dev server, there
    // is no Go side to ask.
    if (isMyGo()) void Desktop.info().then(setInfo);
    void backend.recent().then(setRecent, () => {
      setRecent([]);
    });
  }, []);

  const attempt = useCallback(
    async (open: () => Promise<VaultInfo | null>) => {
      setError(undefined);
      try {
        const vault = await open();
        if (vault !== null) onOpen(vault);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [onOpen],
  );

  const forget = async (vault: VaultInfo) => {
    await backend.forget(vault.id);
    setRecent((list) => list.filter((item) => item.id !== vault.id));
  };

  const about =
    info === null
      ? t("browserPreview")
      : t("version", {
          version: info.version,
          platform: platforms[info.platform] ?? info.platform,
        });

  return (
    <main className="shell">
      <Mark className="mark" />
      <h1>{t("appName")}</h1>
      <p className="lead">{t("tagline")}</p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => void attempt(() => backend.choose())}
        >
          {t("openFolder")}
        </button>
        <p className="hint">{t("openFolderHint")}</p>
      </div>
      {error === undefined ? null : (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {recent.length === 0 ? null : (
        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title">{t("recentVaults")}</h2>
          <ul>
            {recent.map((vault) => (
              <li key={vault.id}>
                <button
                  type="button"
                  className="vault-link"
                  onClick={() => void attempt(() => backend.open(vault.path))}
                >
                  <span className="vault-name">{vault.name}</span>
                  <span className="vault-path">{vault.path}</span>
                </button>
                <button
                  type="button"
                  className="quiet"
                  aria-label={t("forgetVault", { name: vault.name })}
                  onClick={() => void forget(vault)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="about">{about}</p>
    </main>
  );
}

// Only the web app shows it before a vault opens.
const ServersDialog = lazy(() =>
  import("./ServersDialog.tsx").then(({ ServersDialog: dialog }) => ({ default: dialog })),
);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Leaves a link's page, as /invite or /sign-in, for the app's own, once it is used. */
function leaveLink(): void {
  history.replaceState(null, "", "/");
}

/**
 * The web app's start (ADR 0053): signing in to its server, then the
 * account's workspaces, each a vault. It takes the links the server sends:
 * an invitation, at /invite#..., and a code to sign in with, at
 * /sign-in#email=...&code=....
 */
function WebWelcome(props: { readonly onOpen: (vault: VaultInfo) => void }) {
  const { onOpen } = props;
  const [signedIn, setSignedIn] = useState<ServerAccount | null | undefined>();
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  /** Whether the server could not be reached, and the workspaces are those kept here. */
  const [offline, setOffline] = useState(false);
  const [invitation, setInvitation] = useState(
    location.pathname === "/invite" ? location.href : undefined,
  );
  const [dialog, setDialog] = useState(invitation !== undefined);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const load = useCallback(async () => {
    const [found] = await backend.servers();
    if (found === undefined) {
      setSignedIn(null);
      return;
    }
    try {
      const known = await webWorkspaces();
      setWorkspaces(known.workspaces);
      setOffline(known.offline);
      setSignedIn(found);
    } catch (reason) {
      if (reason instanceof ServerError && reason.status === 401) {
        setSignedIn(null);
      } else {
        setSignedIn(found);
        setError(messageOf(reason));
      }
    }
  }, []);

  useEffect(() => {
    // A sign-in email's link: its code, after the #, signs in here.
    const link = new URLSearchParams(location.hash.slice(1));
    const email = link.get("email");
    const code = link.get("code");
    if (location.pathname === "/sign-in" && email !== null && code !== null) {
      setStatus(t("webSigningIn"));
      void redeemCode(webFetch, webServer, email, code)
        .then(async (done) => {
          await backend.saveServer({ url: webServer, user: done.user }, done.token);
          setStatus(undefined);
        })
        .catch((reason: unknown) => {
          setStatus(undefined);
          setError(messageOf(reason));
        })
        .finally(() => {
          leaveLink();
          void load();
        });
      return;
    }
    if (location.pathname !== "/invite") leaveLink();
    void load();
  }, [load]);

  const make = async (event: SyntheticEvent) => {
    event.preventDefault();
    const named = name.trim();
    if (named === "" || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await makeWorkspace(webFetch, webServer, "", named);
      setName("");
      await load();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const open = async (workspace: Workspace) => {
    setError(undefined);
    try {
      onOpen(await backend.open(workspace.id));
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  const host = new URL(webServer).host;
  return (
    <main className="shell">
      <Mark className="mark" />
      <h1>{t("appName")}</h1>
      <p className="lead">{t("tagline")}</p>
      {signedIn === null ? (
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setDialog(true);
            }}
          >
            {t("webSignIn")}
          </button>
          <p className="hint">{t("webSignInLead", { server: host })}</p>
        </div>
      ) : null}
      {status === undefined ? null : <p role="status">{status}</p>}
      {offline && signedIn !== null ? <p role="status">{t("webOffline")}</p> : null}
      {error === undefined ? null : (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {signedIn === null || signedIn === undefined ? null : (
        <>
          <section className="recent" aria-labelledby="workspaces-title">
            <h2 id="workspaces-title">{t("webWorkspaces")}</h2>
            {workspaces.length === 0 ? (
              <p className="hint">{t("webNoWorkspaces")}</p>
            ) : (
              <ul>
                {workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <button
                      type="button"
                      className="vault-link"
                      onClick={() => void open(workspace)}
                    >
                      <span className="vault-name">{workspace.name}</span>
                      <span className="vault-path">
                        {workspace.encrypted ? t("webEncrypted") : host}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="new-workspace" onSubmit={(event) => void make(event)}>
              <label className="field">
                {t("webWorkspaceName")}
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              </label>
              <button type="submit" disabled={busy}>
                {t("webNewWorkspace")}
              </button>
            </form>
          </section>
          <p className="hint account-line">
            {t("webSignedInAs", { name: signedIn.user.name, email: signedIn.user.email })}{" "}
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setDialog(true);
              }}
            >
              {t("webAccount")}
            </button>
          </p>
        </>
      )}
      <p className="about">{t("webServedBy", { server: host })}</p>
      {dialog ? (
        <Suspense fallback={null}>
          <ServersDialog
            only={webServer}
            {...(invitation === undefined ? {} : { invitation })}
            onAccount={() => {
              void load();
            }}
            onClose={() => {
              setDialog(false);
              if (invitation !== undefined) {
                setInvitation(undefined);
                leaveLink();
              }
              void load();
            }}
          />
        </Suspense>
      ) : null}
    </main>
  );
}

export function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  // The note the command line named, for the vault it named.
  const [start, setStart] = useState<{ readonly vault: string; readonly note: string }>();

  useEffect(() => {
    void backend.startup().then(
      (startup) => {
        if (startup === null) return;
        setVault(startup.vault);
        if (startup.note !== "") setStart({ vault: startup.vault.id, note: startup.note });
      },
      () => undefined,
    );
  }, []);

  return vault === null ? (
    backend.kind === "web" ? (
      <WebWelcome onOpen={setVault} />
    ) : (
      <Welcome onOpen={setVault} />
    )
  ) : (
    <VaultView
      key={vault.id}
      info={vault}
      {...(start?.vault === vault.id ? { note: start.note } : {})}
      onClose={() => {
        setVault(null);
        setStart(undefined);
      }}
    />
  );
}
