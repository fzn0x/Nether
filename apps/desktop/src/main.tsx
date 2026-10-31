import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyMode } from "./appearance.ts";
import { directionOf, language } from "./messages.ts";
import "./style.css";

// The interface's language, and the direction its layout follows.
document.documentElement.lang = language;
document.documentElement.dir = directionOf(language);
// Light or dark as the system is, until a vault's appearance says otherwise.
applyMode("system");

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
