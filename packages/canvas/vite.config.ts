import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canvasRelay } from "./server/relay";
import { devBoards } from "./server/boards-dev";

const canvasDir = fileURLToPath(new URL(".", import.meta.url));

// PAIRED_SERVER_URL (for example http://localhost:3100) points the dev canvas at a real
// paired.cc server: sign-in (/auth) and boards (/api/canvas/boards) are proxied to it instead of
// the one-person development board store, so board sync can be checked against the real
// server and accounts without a production build (which needs a tldraw licence key).
const server = process.env.PAIRED_SERVER_URL?.replace(/\/$/, "");

export default defineConfig(({ command }) => ({
  base: "/canvas/",
  plugins: [react(), ...(server ? [] : [devBoards()]), canvasRelay()],
  server: {
    strictPort: true,
    ...(server ? { proxy: { "/auth": { target: server }, "/api/canvas/boards": { target: server } } } : {}),
  },
  define: {
    // Only the dev server needs the local path (for Agent access); builds never embed it.
    __CANVAS_DIR__: JSON.stringify(command === "serve" ? canvasDir : ""),
    __BOARDS_ON_SERVER__: JSON.stringify(command === "build" || Boolean(server)),
  },
}));
