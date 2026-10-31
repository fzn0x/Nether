// The web app (ADR 0053) is the desktop app's page, built from its sources
// for the browser: VITE_NETHER_TARGET=web picks the web backend, which keeps
// each workspace in the origin's private file system and syncs with the
// server that serves the page. In development the API, and its sockets,
// go to a server running on this machine.
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import desktop from "../desktop/vite.config.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const server = process.env.NETHER_SERVER ?? "http://127.0.0.1:3000";

export default mergeConfig(
  desktop,
  defineConfig({
    root: here("../desktop"),
    cacheDir: here("node_modules/.vite"),
    define: { "import.meta.env.VITE_NETHER_TARGET": JSON.stringify("web") },
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
