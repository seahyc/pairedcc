import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://pairedcc:pairedcc_dev@localhost:5432/pairedcc',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-at-least-16-chars',
      BASE_URL: 'http://localhost:3000',
    },
  },
})
