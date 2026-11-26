import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Runs against the real server on its own port (default 3100, so a dev server on 3000 is left
// alone). Requires Postgres and Redis; see README.md in this directory.
const port = Number(process.env.E2E_PORT ?? 3100)
process.env.E2E_SERVER_LOG ??= join(tmpdir(), `paired-e2e-server-${port}.log`)

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    // Optional: a Chromium already on the machine (for example /opt/pw-browsers/chromium).
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node serve.mjs',
    url: `http://localhost:${port}/docs/`,
    env: { PORT: String(port), E2E_SERVER_LOG: process.env.E2E_SERVER_LOG },
    timeout: 180_000,
    reuseExistingServer: false,
  },
})
