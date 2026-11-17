import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canvasRelay } from "./server/relay";

export default defineConfig({
  base: "/canvas/",
  plugins: [react(), canvasRelay()],
  server: { strictPort: true },
});
