import { isMyGo } from "mygo-runtime";
import { useEffect, useState } from "react";
import { Mark } from "./Mark.tsx";
import { type AppInfo, Desktop } from "./mygo.ts";

const platforms: Partial<Record<string, string>> = {
  darwin: "macOS",
  linux: "Linux",
  windows: "Windows",
};

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    // Outside the desktop app, as in a browser tab of the dev server, there
    // is no Go side to ask.
    if (isMyGo()) void Desktop.info().then(setInfo);
  }, []);

  const about =
    info === null
      ? "Browser preview"
      : `Version ${info.version} for ${platforms[info.platform] ?? info.platform}`;

  return (
    <main className="shell">
      <Mark className="mark" />
      <h1>Nether</h1>
      <p className="lead">
        Notes that stay plain Markdown files you own, with databases and collaboration on a server
        you control.
      </p>
      <p className="status">
        <strong>Early development.</strong> The vault and the editor arrive in the next phase of the
        roadmap.
      </p>
      <p className="about">{about}</p>
    </main>
  );
}
