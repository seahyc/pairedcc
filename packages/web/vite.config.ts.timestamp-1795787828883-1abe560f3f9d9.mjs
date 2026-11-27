// vite.config.ts
import { defineConfig } from "file:///home/user/pairedcc/node_modules/.pnpm/vite@6.4.1_@types+node@26.6.6_tsx@4.23.15/node_modules/vite/dist/node/index.js";
import react from "file:///home/user/pairedcc/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.1_@types+node@26.6.6_tsx@4.23.15_/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig({
  // Document editor is served under /docs (the canvas owns /).
  base: "/docs/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/auth": "http://localhost:3001",
      "/ws": { target: "http://localhost:3001", ws: true }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL3BhaXJlZGNjL3BhY2thZ2VzL3dlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvdXNlci9wYWlyZWRjYy9wYWNrYWdlcy93ZWIvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvdXNlci9wYWlyZWRjYy9wYWNrYWdlcy93ZWIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICAvLyBEb2N1bWVudCBlZGl0b3IgaXMgc2VydmVkIHVuZGVyIC9kb2NzICh0aGUgY2FudmFzIG93bnMgLykuXG4gIGJhc2U6ICcvZG9jcy8nLFxuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIHNlcnZlcjoge1xuICAgIHByb3h5OiB7XG4gICAgICAnL2FwaSc6ICdodHRwOi8vbG9jYWxob3N0OjMwMDEnLFxuICAgICAgJy9hdXRoJzogJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMScsXG4gICAgICAnL3dzJzogeyB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjMwMDEnLCB3czogdHJ1ZSB9XG4gICAgfVxuICB9XG59KVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFrUixTQUFTLG9CQUFvQjtBQUMvUyxPQUFPLFdBQVc7QUFFbEIsSUFBTyxzQkFBUSxhQUFhO0FBQUE7QUFBQSxFQUUxQixNQUFNO0FBQUEsRUFDTixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsUUFBUTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLE1BQ1QsT0FBTyxFQUFFLFFBQVEseUJBQXlCLElBQUksS0FBSztBQUFBLElBQ3JEO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
