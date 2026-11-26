import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canvasRelay } from "./server/relay";
import { devBoards } from "./server/boards-dev";

export default defineConfig({
  base: "/canvas/",
  plugins: [react(), devBoards(), canvasRelay()],
  server: { strictPort: true },
});
