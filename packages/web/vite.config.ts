import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Document editor is served under /docs (the canvas owns /).
  base: '/docs/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
      '/ws': { target: 'http://localhost:3001', ws: true }
    }
  }
})
