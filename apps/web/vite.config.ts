// The web app (ADR 0053) is the desktop app's page, built from its sources
// for the browser: VITE_NETHER_TARGET=web picks the web backend, which keeps
// each workspace in the origin's private file system and syncs with the
// server that serves the page. The build adds what installs it: a web
// manifest, its icons, and a service worker that keeps every file of the
// build, so it opens offline. In development the API, and its sockets, go
// to a server running on this machine.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig, mergeConfig } from "vite";
import desktop from "../desktop/vite.config.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const server = process.env.NETHER_SERVER ?? "http://127.0.0.1:3000";

/** The page's background, light and dark, as style.css has it. */
const light = "#f7f5f0";
const dark = "#131118";

const manifest = {
  name: "Nether",
  short_name: "Nether",
  description: "Notes that stay plain Markdown files you own, on a server you control.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: light,
  theme_color: light,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
};

/**
 * The service worker: it keeps every file of this build, named by the
 * build's files so a new build is a new worker; pages come from the
 * network while it answers, so a new version shows, and from what it kept
 * offline; the API is never kept. A new version waits for the old one's
 * pages to close, so they never miss their files.
 */
function serviceWorker(version: string, files: readonly string[]): string {
  return `// Made by the web app's build (apps/web/vite.config.ts).
const cacheName = ${JSON.stringify(`nether-${version}`)};
const files = ${JSON.stringify(files)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(files)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("nether-") && name !== cacheName)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.open(cacheName).then((cache) => cache.match("/")).then((page) => page ?? Response.error()),
      ),
    );
    return;
  }
  event.respondWith(
    caches.open(cacheName).then((cache) => cache.match(request)).then((kept) => kept ?? fetch(request)),
  );
});
`;
}

/** A short hash of a text, to name a build by its files. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The manifest, the icons' tags, and the service worker, in the web app's build. */
function installable(): Plugin {
  return {
    name: "nether:installable",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "link",
          attrs: { rel: "manifest", href: "/manifest.webmanifest" },
          injectTo: "head",
        },
        {
          tag: "link",
          attrs: { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
          injectTo: "head",
        },
        {
          tag: "link",
          attrs: { rel: "apple-touch-icon", href: "/icon-192.png" },
          injectTo: "head",
        },
        {
          tag: "meta",
          attrs: { name: "theme-color", content: light, media: "(prefers-color-scheme: light)" },
          injectTo: "head",
        },
        {
          tag: "meta",
          attrs: { name: "theme-color", content: dark, media: "(prefers-color-scheme: dark)" },
          injectTo: "head",
        },
      ];
    },
    generateBundle(_options, bundle) {
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
      // The page as "/", which the server answers with it: Vite adds
      // index.html to the bundle after this.
      const built = Object.keys(bundle).filter((name) => name !== "index.html");
      const kept = [
        "/",
        ...built.map((name) => `/${name}`),
        "/manifest.webmanifest",
        ...readdirSync(here("public")).map((name) => `/${name}`),
      ].sort();
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorker(hashOf(kept.join("\n")), kept),
      });
    },
  };
}

export default mergeConfig(
  desktop,
  defineConfig({
    root: here("../desktop"),
    publicDir: here("public"),
    cacheDir: here("node_modules/.vite"),
    define: { "import.meta.env.VITE_NETHER_TARGET": JSON.stringify("web") },
    plugins: [installable()],
    build: { outDir: here("dist"), emptyOutDir: true },
    server: {
      port: 5174,
      proxy: { "/api": { target: server, ws: true, changeOrigin: false } },
    },
    preview: {
      port: 4174,
      proxy: { "/api": { target: server, ws: true, changeOrigin: false } },
    },
  }),
);
