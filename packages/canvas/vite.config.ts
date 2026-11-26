import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canvasRelay } from "./server/relay";

const canvasDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command }) => ({
  base: "/canvas/",
  plugins: [react(), canvasRelay()],
  server: { strictPort: true },
  // Only the dev server needs the local path (for Agent access); builds never embed it.
  define: { __CANVAS_DIR__: JSON.stringify(command === "serve" ? canvasDir : "") },
}));
