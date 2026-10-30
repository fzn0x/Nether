import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

/**
 * The link index parses notes in a worker, which has no `document`. The
 * browser build of micromark's entity decoder decodes with one; its other
 * build carries the table of entities instead. The page uses that build
 * too, so the dev server and the build, page and worker, all run the same.
 */
function decodeEntitiesWithoutDom(): Plugin {
  return {
    name: "nether:decode-entities-without-dom",
    // Before Vite's own resolver, which would pick the browser build.
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source !== "decode-named-character-reference") return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved === null
        ? null
        : { ...resolved, id: resolved.id.replace(/index\.dom\.js$/, "index.js") };
    },
  };
}

export default defineConfig({
  plugins: [react(), decodeEntitiesWithoutDom()],
  worker: {
    format: "es",
    plugins: () => [decodeEntitiesWithoutDom()],
  },
  server: {
    // `mygo dev` loads this address (devUrl in mygo.json).
    port: 5173,
    strictPort: true,
    // MyGO's development app and the packaged builds are not the page's.
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
});
