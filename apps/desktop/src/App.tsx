import { isMyGo } from "mygo-runtime";
import { useCallback, useEffect, useState } from "react";
import { Mark } from "./Mark.tsx";
import { VaultView } from "./VaultView.tsx";
import { backend } from "./backend.ts";
import { t } from "./messages.ts";
import { type AppInfo, Desktop, type VaultInfo } from "./mygo.ts";

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

export function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);

  useEffect(() => {
    void backend.startup().then(
      (startup) => {
        if (startup !== null) setVault(startup);
      },
      () => undefined,
    );
  }, []);

  return vault === null ? (
    <Welcome onOpen={setVault} />
  ) : (
    <VaultView
      key={vault.id}
      info={vault}
      onClose={() => {
        setVault(null);
      }}
    />
  );
}
