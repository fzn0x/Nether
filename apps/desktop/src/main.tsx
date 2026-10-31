import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyMode } from "./appearance.ts";
import { build } from "./features.ts";
import { directionOf, language, t } from "./messages.ts";
import { providerChannel, providerReturn } from "./web.ts";
import "./style.css";

// The interface's language, and the direction its layout follows.
document.documentElement.lang = language;
document.documentElement.dir = directionOf(language);
// Light or dark as the system is, until a vault's appearance says otherwise.
applyMode("system");

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

if (build.web && location.pathname === providerReturn) {
  // A provider sent the browser back here: the tab that is signing in
  // waits for this query (webBackend.ts), and this window can go.
  const channel = new BroadcastChannel(providerChannel);
  channel.postMessage(Object.fromEntries(new URLSearchParams(location.search)));
  channel.close();
  const done = document.createElement("p");
  done.className = "provider-done";
  done.textContent = t("webProviderDone");
  root.append(done);
  window.close();
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
