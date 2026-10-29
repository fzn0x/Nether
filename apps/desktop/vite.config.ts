import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // `mygo dev` loads this address (devUrl in mygo.json).
    port: 5173,
    strictPort: true,
    // MyGO's development app and the packaged builds are not the page's.
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
});
