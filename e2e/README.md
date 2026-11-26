# End-to-end tests

`tests/editor-collab.spec.ts` checks that two signed-in people can edit the same document:
both sign in through the real magic-link flow, the first creates a document and invites the
second through **Share**, then text typed by one appears for the other and both show as present.

## What it needs

- **Postgres** (any recent version) with an empty database: `DATABASE_URL`.
- **Redis**: `REDIS_URL`.
- **`JWT_SECRET`**: any string of 16 or more characters. Use a throwaway value, never a real secret.
- Playwright's Chromium. If the browser that `@playwright/test` expects is not installed, point
  `PLAYWRIGHT_CHROMIUM_PATH` at a Chromium on the machine.

`node serve.mjs` (started by Playwright) builds the document editor, serves it from a temporary
directory under `/docs` as production does, and runs the server on port 3100 (`E2E_PORT` to
change it), so a development server on 3000 is untouched. The server runs its migrations on start.
It prints magic links instead of emailing them; the test reads them from the server log
(`E2E_SERVER_LOG`, by default in the system temp directory). Test accounts use synthetic
`@example.test` addresses that are unique to each run.

## Running it locally

```sh
# Throwaway services, for example:
initdb -D /var/tmp/pg-e2e -A trust -U paired && pg_ctl -D /var/tmp/pg-e2e -o '-p 5433' -l /var/tmp/pg-e2e.log start
createdb -h localhost -p 5433 -U paired paired_e2e
redis-server --port 6380 --daemonize yes --save ''

DATABASE_URL=postgres://paired@localhost:5433/paired_e2e \
REDIS_URL=redis://localhost:6380 \
JWT_SECRET=e2e-only-throwaway-secret \
pnpm --filter @pairedcc/e2e test
```

Without those variables the web server step stops with a message naming the missing one.
