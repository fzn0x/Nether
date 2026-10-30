import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { directionOf, language } from "./messages.ts";
import "./style.css";

// The interface's language, and the direction its layout follows.
document.documentElement.lang = language;
document.documentElement.dir = directionOf(language);

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
