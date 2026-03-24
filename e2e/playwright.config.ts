import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'cd .. && pnpm dev',
    port: 3000,
    reuseExistingServer: true,
  },
})
