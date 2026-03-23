# paired.cc MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time collaborative markdown editor where humans and AI agents share cursors, presence, and edit capabilities.

**Architecture:** TypeScript monorepo. Hono server owns Yjs document state, serves React frontend, exposes REST + WebSocket APIs. Agents connect via MCP server or CLI. Postgres for persistence, Redis for presence/pub-sub.

**Tech Stack:** TypeScript, Hono, Yjs, Tiptap (React), PostgreSQL, Redis, Docker Compose

**Spec:** `docs/superpowers/specs/2026-03-23-paired-cc-mvp-design.md`

---

## File Structure

```
pairedcc/
├── package.json                    # Root workspace config
├── tsconfig.json                   # Shared TS config
├── docker-compose.yml              # app + postgres + redis
├── Dockerfile                      # Multi-stage: build + runtime
├── .env.example                    # Template for env vars
│
├── packages/
│   ├── server/                     # Hono backend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # Entry: Hono app + WebSocket server
│   │   │   ├── config.ts           # Env var loading + validation
│   │   │   ├── db/
│   │   │   │   ├── client.ts       # Postgres client (pg or postgres.js)
│   │   │   │   ├── migrate.ts      # Migration runner
│   │   │   │   └── migrations/
│   │   │   │       └── 001_initial.sql
│   │   │   ├── redis.ts            # Redis client
│   │   │   ├── auth/
│   │   │   │   ├── middleware.ts    # JWT verification middleware
│   │   │   │   ├── github.ts       # GitHub OAuth flow
│   │   │   │   ├── google.ts       # Google OAuth flow
│   │   │   │   ├── magic-link.ts   # Email magic link flow
│   │   │   │   └── jwt.ts          # JWT sign/verify helpers
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts         # /auth/* routes
│   │   │   │   ├── documents.ts    # /api/documents/* CRUD
│   │   │   │   ├── sharing.ts      # /api/documents/:id/share
│   │   │   │   ├── api-keys.ts     # /api/keys/* management
│   │   │   │   ├── snapshots.ts    # /api/documents/:id/snapshots
│   │   │   │   └── agent.ts        # /api/agent/* (MCP-style REST)
│   │   │   ├── yjs/
│   │   │   │   ├── doc-manager.ts  # In-memory Yjs doc registry
│   │   │   │   ├── ws-handler.ts   # WebSocket connection handler
│   │   │   │   ├── mention-detector.ts # Detect @-mentions in Yjs updates
│   │   │   │   └── snapshot-store.ts   # SnapshotStore interface + PostgresSnapshotStore
│   │   │   └── presence/
│   │   │       └── tracker.ts      # Redis-backed presence tracking
│   │   └── tests/
│   │       ├── auth.test.ts
│   │       ├── documents.test.ts
│   │       ├── yjs-doc-manager.test.ts
│   │       ├── mention-detector.test.ts
│   │       ├── snapshot-store.test.ts
│   │       └── agent-api.test.ts
│   │
│   ├── web/                        # React frontend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx            # React entry
│   │   │   ├── App.tsx             # Router setup
│   │   │   ├── api.ts              # Fetch wrapper for server API
│   │   │   ├── pages/
│   │   │   │   ├── Login.tsx       # OAuth + magic link buttons
│   │   │   │   ├── Dashboard.tsx   # Doc list + create
│   │   │   │   ├── Editor.tsx      # Main editor page (shell)
│   │   │   │   └── Settings.tsx    # API key management
│   │   │   ├── components/
│   │   │   │   ├── editor/
│   │   │   │   │   ├── TiptapEditor.tsx    # Tiptap instance + extensions
│   │   │   │   │   ├── MentionList.tsx     # @-mention autocomplete dropdown
│   │   │   │   │   └── CursorPresence.tsx  # Cursor labels + avatars
│   │   │   │   ├── TopBar.tsx              # Logo, title, presence, share
│   │   │   │   ├── PresenceAvatars.tsx     # Colored avatars for users + agents
│   │   │   │   ├── ShareDialog.tsx         # Invite + API key creation
│   │   │   │   └── VersionHistory.tsx      # Sidebar: snapshot list + restore
│   │   │   ├── hooks/
│   │   │   │   ├── useAuth.ts      # Auth state + login/logout
│   │   │   │   ├── useDocument.ts  # Doc loading + Yjs provider setup
│   │   │   │   └── usePresence.ts  # Presence state from Yjs awareness
│   │   │   └── styles/
│   │   │       └── globals.css     # Base styles, dark theme
│   │   └── tests/
│   │       └── editor.test.tsx
│   │
│   ├── mcp-server/                 # MCP server for Claude Code etc.
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # MCP server entry (stdio transport)
│   │   │   ├── tools.ts            # Tool definitions: list/read/edit/mentions/presence
│   │   │   └── client.ts           # HTTP+WS client to paired.cc server
│   │   └── tests/
│   │       └── tools.test.ts
│   │
│   └── cli/                        # pairedcc CLI
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts            # CLI entry (commander)
│       │   ├── commands/
│       │   │   ├── join.ts         # pairedcc join <doc-id>
│       │   │   ├── watch.ts        # pairedcc watch <doc-id>
│       │   │   └── edit.ts         # pairedcc edit <doc-id>
│       │   └── client.ts           # Shared HTTP+WS client (reuse from mcp-server)
│       └── tests/
│           └── commands.test.ts
│
└── e2e/
    ├── package.json
    ├── playwright.config.ts
    └── tests/
        ├── auth.spec.ts
        ├── editor-collab.spec.ts
        └── agent-integration.spec.ts
```

---

## Task 1: Project Scaffolding + Docker Compose

**Files:**
- Create: `package.json`, `tsconfig.json`, `docker-compose.yml`, `Dockerfile`, `.env.example`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`

- [ ] **Step 1: Initialize monorepo with pnpm workspaces**

```json
// package.json
{
  "name": "pairedcc",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "pnpm --filter server dev & pnpm --filter web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
  - "e2e"
```

```json
// tsconfig.json (root)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 2: Create server package**

```json
// packages/server/package.json
{
  "name": "@pairedcc/server",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run"
  },
  "dependencies": {
    "hono": "^4",
    "@hono/node-server": "^1",
    "@hono/node-ws": "^1",
    "yjs": "^13",
    "postgres": "^3",
    "ioredis": "^5",
    "jsonwebtoken": "^9",
    "bcrypt": "^5",
    "nanoid": "^5"
  },
  "devDependencies": {
    "tsx": "^4",
    "tsup": "^8",
    "vitest": "^2",
    "typescript": "^5",
    "@types/node": "^22",
    "@types/jsonwebtoken": "^9",
    "@types/bcrypt": "^5"
  }
}
```

```json
// packages/server/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create web package with Vite + React**

```json
// packages/web/package.json
{
  "name": "@pairedcc/web",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "react-router-dom": "^7",
    "@tiptap/react": "^2",
    "@tiptap/starter-kit": "^2",
    "@tiptap/extension-collaboration": "^2",
    "@tiptap/extension-collaboration-cursor": "^2",
    "@tiptap/extension-mention": "^2",
    "@tiptap/extension-table": "^2",
    "@tiptap/extension-task-list": "^2",
    "@tiptap/extension-task-item": "^2",
    "@tiptap/extension-code-block-lowlight": "^2",
    "@tiptap/extension-image": "^2",
    "@tiptap/extension-link": "^2",
    "yjs": "^13",
    "y-websocket": "^2"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4",
    "vite": "^6",
    "vitest": "^2",
    "typescript": "^5",
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

```ts
// packages/web/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true }
    }
  }
})
```

```html
<!-- packages/web/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>paired.cc</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 4: Create Docker Compose + Dockerfile**

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: pairedcc
      POSTGRES_USER: pairedcc
      POSTGRES_PASSWORD: pairedcc_dev
    volumes: ["pgdata:/var/lib/postgresql/data"]
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pairedcc"]
      interval: 2s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  pgdata:
```

```dockerfile
# Dockerfile
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter web build
RUN pnpm --filter server build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/web/dist ./public
COPY --from=build /app/packages/server/package.json ./
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

```bash
# .env.example
DATABASE_URL=postgres://pairedcc:pairedcc_dev@localhost:5432/pairedcc
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-in-production
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SMTP_URL=
BASE_URL=http://localhost:3000
```

- [ ] **Step 5: Install dependencies and verify build**

Run: `pnpm install`
Expected: Clean install, no errors.

Run: `docker compose up -d postgres redis`
Expected: Postgres and Redis containers start.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold monorepo with server, web, docker compose"
```

---

## Task 2: Database Schema + Migration

**Files:**
- Create: `packages/server/src/config.ts`
- Create: `packages/server/src/db/client.ts`
- Create: `packages/server/src/db/migrate.ts`
- Create: `packages/server/src/db/migrations/001_initial.sql`
- Test: `packages/server/tests/documents.test.ts`

- [ ] **Step 1: Write migration SQL**

```sql
-- packages/server/src/db/migrations/001_initial.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'magic',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Untitled',
  owner_id UUID NOT NULL REFERENCES users(id),
  yjs_state BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_collaborators (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);

CREATE TABLE document_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('human', 'agent')),
  yjs_snapshot BYTEA NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshots_doc_id ON document_snapshots(document_id, created_at DESC);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
```

- [ ] **Step 2: Write config loader**

```ts
// packages/server/src/config.ts
import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(16),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SMTP_URL: z.string().optional(),
  BASE_URL: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().default(3000),
})

export const config = envSchema.parse(process.env)
export type Config = z.infer<typeof envSchema>
```

Add `zod` to server dependencies.

- [ ] **Step 3: Write DB client + migration runner**

```ts
// packages/server/src/db/client.ts
import postgres from 'postgres'
import { config } from '../config.js'

export const sql = postgres(config.DATABASE_URL)
```

```ts
// packages/server/src/db/migrate.ts
import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { sql } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `

  const dir = join(__dirname, 'migrations')
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()

  for (const file of files) {
    const [applied] = await sql`SELECT 1 FROM _migrations WHERE name = ${file}`
    if (applied) continue

    const content = await readFile(join(dir, file), 'utf-8')
    await sql.begin(async (tx) => {
      await tx.unsafe(content)
      await tx`INSERT INTO _migrations (name) VALUES (${file})`
    })
    console.log(`Applied migration: ${file}`)
  }
}
```

- [ ] **Step 4: Write test for migration + basic doc CRUD**

```ts
// packages/server/tests/documents.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from '../src/db/client.js'
import { migrate } from '../src/db/migrate.js'

beforeAll(async () => {
  await migrate()
})

afterAll(async () => {
  await sql.end()
})

describe('documents', () => {
  it('creates a user and document', async () => {
    const [user] = await sql`
      INSERT INTO users (email, name, auth_provider)
      VALUES ('test@example.com', 'Test User', 'magic')
      RETURNING *
    `
    expect(user.id).toBeDefined()

    const [doc] = await sql`
      INSERT INTO documents (title, owner_id)
      VALUES ('Test Doc', ${user.id})
      RETURNING *
    `
    expect(doc.title).toBe('Test Doc')
    expect(doc.owner_id).toBe(user.id)
  })
})
```

- [ ] **Step 5: Run migration test**

Run: `docker compose up -d postgres && cd packages/server && pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: database schema, migration runner, and doc CRUD test"
```

---

## Task 3: Hono Server + Auth (JWT, GitHub, Google, Magic Link)

**Files:**
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/auth/jwt.ts`
- Create: `packages/server/src/auth/middleware.ts`
- Create: `packages/server/src/auth/github.ts`
- Create: `packages/server/src/auth/google.ts`
- Create: `packages/server/src/auth/magic-link.ts`
- Create: `packages/server/src/routes/auth.ts`
- Test: `packages/server/tests/auth.test.ts`

- [ ] **Step 1: Write JWT helpers**

```ts
// packages/server/src/auth/jwt.ts
import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export interface JwtPayload {
  userId: string
  email: string
}

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '30d' })
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, config.JWT_SECRET) as JwtPayload
}
```

- [ ] **Step 2: Write auth middleware**

```ts
// packages/server/src/auth/middleware.ts
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyJwt, type JwtPayload } from './jwt.js'
import { sql } from '../db/client.js'

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload & { name?: string }
  }
}

export const requireAuth = createMiddleware(async (c, next) => {
  const token = getCookie(c, 'session') || c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = verifyJwt(token)
    c.set('user', payload)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

export const requireApiKey = createMiddleware(async (c, next) => {
  const key = c.req.header('X-API-Key')
  if (!key) return c.json({ error: 'API key required' }, 401)

  const [row] = await sql`
    SELECT ak.user_id, u.email, u.name
    FROM api_keys ak JOIN users u ON ak.user_id = u.id
    WHERE ak.key_hash = crypt(${key}, ak.key_hash)
  `
  if (!row) return c.json({ error: 'Invalid API key' }, 401)

  await sql`UPDATE api_keys SET last_used = now() WHERE key_hash = crypt(${key}, key_hash)`
  c.set('user', { userId: row.user_id, email: row.email, name: row.name })
  await next()
})
```

- [ ] **Step 3: Write GitHub OAuth handler**

```ts
// packages/server/src/auth/github.ts
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { config } from '../config.js'
import { sql } from '../db/client.js'
import { signJwt } from './jwt.js'

export const github = new Hono()

github.get('/login', (c) => {
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID!,
    redirect_uri: `${config.BASE_URL}/auth/github/callback`,
    scope: 'user:email',
  })
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

github.get('/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.json({ error: 'Missing code' }, 400)

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const { access_token } = await tokenRes.json() as { access_token: string }

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const ghUser = await userRes.json() as { email: string; name: string; avatar_url: string }

  // Get primary email if not public
  let email = ghUser.email
  if (!email) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const emails = await emailRes.json() as { email: string; primary: boolean }[]
    email = emails.find(e => e.primary)?.email ?? emails[0]?.email
  }

  const [user] = await sql`
    INSERT INTO users (email, name, avatar_url, auth_provider)
    VALUES (${email}, ${ghUser.name}, ${ghUser.avatar_url}, 'github')
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
    RETURNING *
  `

  const token = signJwt({ userId: user.id, email: user.email })
  setCookie(c, 'session', token, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 })
  return c.redirect('/')
})
```

- [ ] **Step 4: Write Google OAuth handler**

```ts
// packages/server/src/auth/google.ts
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { config } from '../config.js'
import { sql } from '../db/client.js'
import { signJwt } from './jwt.js'

export const google = new Hono()

google.get('/login', (c) => {
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    redirect_uri: `${config.BASE_URL}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

google.get('/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.json({ error: 'Missing code' }, 400)

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID!,
      client_secret: config.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${config.BASE_URL}/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const { access_token } = await tokenRes.json() as { access_token: string }

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const gUser = await userRes.json() as { email: string; name: string; picture: string }

  const [user] = await sql`
    INSERT INTO users (email, name, avatar_url, auth_provider)
    VALUES (${gUser.email}, ${gUser.name}, ${gUser.picture}, 'google')
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
    RETURNING *
  `

  const token = signJwt({ userId: user.id, email: user.email })
  setCookie(c, 'session', token, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 })
  return c.redirect('/')
})
```

- [ ] **Step 5: Write magic link handler**

```ts
// packages/server/src/auth/magic-link.ts
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { config } from '../config.js'
import { sql } from '../db/client.js'
import { signJwt } from './jwt.js'
import { nanoid } from 'nanoid'

// In-memory token store for MVP. Replace with Redis for production.
const pendingTokens = new Map<string, { email: string; expiresAt: number }>()

export const magicLink = new Hono()

magicLink.post('/send', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  if (!email) return c.json({ error: 'Email required' }, 400)

  const token = nanoid(32)
  pendingTokens.set(token, { email, expiresAt: Date.now() + 15 * 60 * 1000 })

  const link = `${config.BASE_URL}/auth/magic/verify?token=${token}`

  // TODO: Send email via SMTP. For now, log the link.
  console.log(`Magic link for ${email}: ${link}`)

  return c.json({ ok: true })
})

magicLink.get('/verify', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Missing token' }, 400)

  const pending = pendingTokens.get(token)
  if (!pending || pending.expiresAt < Date.now()) {
    return c.json({ error: 'Invalid or expired token' }, 400)
  }
  pendingTokens.delete(token)

  const [user] = await sql`
    INSERT INTO users (email, auth_provider)
    VALUES (${pending.email}, 'magic')
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING *
  `

  const jwt = signJwt({ userId: user.id, email: user.email })
  setCookie(c, 'session', jwt, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 })
  return c.redirect('/')
})
```

- [ ] **Step 6: Write auth routes + server entry**

```ts
// packages/server/src/routes/auth.ts
import { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { github } from '../auth/github.js'
import { google } from '../auth/google.js'
import { magicLink } from '../auth/magic-link.js'
import { requireAuth } from '../auth/middleware.js'

export const authRoutes = new Hono()

authRoutes.route('/github', github)
authRoutes.route('/google', google)
authRoutes.route('/magic', magicLink)

authRoutes.get('/me', requireAuth, (c) => {
  return c.json(c.get('user'))
})

authRoutes.post('/logout', (c) => {
  deleteCookie(c, 'session')
  return c.json({ ok: true })
})
```

```ts
// packages/server/src/index.ts
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config.js'
import { migrate } from './db/migrate.js'
import { authRoutes } from './routes/auth.js'

const app = new Hono()

// Auth routes
app.route('/auth', authRoutes)

// API placeholder
app.get('/api/health', (c) => c.json({ ok: true }))

// Serve frontend in production
app.use('/*', serveStatic({ root: './public' }))

async function main() {
  await migrate()
  console.log(`paired.cc server running on port ${config.PORT}`)
  serve({ fetch: app.fetch, port: config.PORT })
}

main()
```

- [ ] **Step 7: Write auth test**

```ts
// packages/server/tests/auth.test.ts
import { describe, it, expect } from 'vitest'
import { signJwt, verifyJwt } from '../src/auth/jwt.js'

describe('JWT', () => {
  it('signs and verifies a token', () => {
    const payload = { userId: 'test-id', email: 'test@example.com' }
    const token = signJwt(payload)
    const decoded = verifyJwt(token)
    expect(decoded.userId).toBe('test-id')
    expect(decoded.email).toBe('test@example.com')
  })

  it('rejects invalid tokens', () => {
    expect(() => verifyJwt('garbage')).toThrow()
  })
})
```

- [ ] **Step 8: Run tests**

Run: `cd packages/server && pnpm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: hono server with auth (github, google, magic link, JWT)"
```

---

## Task 4: Yjs Document Manager + WebSocket Handler

**Files:**
- Create: `packages/server/src/yjs/doc-manager.ts`
- Create: `packages/server/src/yjs/ws-handler.ts`
- Create: `packages/server/src/redis.ts`
- Modify: `packages/server/src/index.ts` (add WebSocket upgrade)
- Test: `packages/server/tests/yjs-doc-manager.test.ts`

- [ ] **Step 1: Write Redis client**

```ts
// packages/server/src/redis.ts
import Redis from 'ioredis'
import { config } from './config.js'

export const redis = new Redis(config.REDIS_URL)
export const redisSub = new Redis(config.REDIS_URL)
```

- [ ] **Step 2: Write failing test for doc manager**

```ts
// packages/server/tests/yjs-doc-manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { DocManager } from '../src/yjs/doc-manager.js'

describe('DocManager', () => {
  let manager: DocManager

  beforeEach(() => {
    manager = new DocManager()
  })

  it('creates and retrieves a doc', () => {
    const doc = manager.getOrCreate('doc-1')
    expect(doc).toBeInstanceOf(Y.Doc)
  })

  it('returns same doc instance for same id', () => {
    const doc1 = manager.getOrCreate('doc-1')
    const doc2 = manager.getOrCreate('doc-1')
    expect(doc1).toBe(doc2)
  })

  it('applies an update and reads content', () => {
    const doc = manager.getOrCreate('doc-1')
    const text = doc.getText('content')
    text.insert(0, 'Hello, world!')
    expect(manager.getMarkdown('doc-1')).toContain('Hello, world!')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- yjs-doc-manager`
Expected: FAIL — `DocManager` not found

- [ ] **Step 4: Implement DocManager**

```ts
// packages/server/src/yjs/doc-manager.ts
import * as Y from 'yjs'

export class DocManager {
  private docs = new Map<string, Y.Doc>()

  getOrCreate(docId: string): Y.Doc {
    let doc = this.docs.get(docId)
    if (!doc) {
      doc = new Y.Doc()
      this.docs.set(docId, doc)
    }
    return doc
  }

  getMarkdown(docId: string): string {
    const doc = this.docs.get(docId)
    if (!doc) return ''
    // Tiptap stores content as XML fragment; for basic text, read from 'content'
    const text = doc.getText('content')
    return text.toString()
  }

  applyUpdate(docId: string, update: Uint8Array): void {
    const doc = this.getOrCreate(docId)
    Y.applyUpdate(doc, update)
  }

  getState(docId: string): Uint8Array | null {
    const doc = this.docs.get(docId)
    if (!doc) return null
    return Y.encodeStateAsUpdate(doc)
  }

  destroy(docId: string): void {
    const doc = this.docs.get(docId)
    if (doc) {
      doc.destroy()
      this.docs.delete(docId)
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- yjs-doc-manager`
Expected: PASS

- [ ] **Step 6: Write WebSocket handler**

```ts
// packages/server/src/yjs/ws-handler.ts
import { createNodeWebSocket } from '@hono/node-ws'
import type { Hono } from 'hono'
import * as Y from 'yjs'
import { DocManager } from './doc-manager.js'

interface Client {
  ws: WebSocket
  docId: string
  userId: string
  name: string
  isAgent: boolean
}

export function setupWebSocket(app: Hono, docManager: DocManager) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as any })
  const clients = new Map<WebSocket, Client>()

  app.get('/ws/:docId', upgradeWebSocket((c) => {
    const docId = c.req.param('docId')

    return {
      onOpen(evt, ws) {
        const rawWs = ws.raw as WebSocket
        const client: Client = {
          ws: rawWs,
          docId,
          userId: 'anonymous', // Will be set from auth
          name: 'Anonymous',
          isAgent: false,
        }
        clients.set(rawWs, client)

        // Send current doc state
        const state = docManager.getState(docId)
        if (state) {
          ws.send(state)
        }
      },

      onMessage(evt, ws) {
        const rawWs = ws.raw as WebSocket
        const client = clients.get(rawWs)
        if (!client) return

        const data = evt.data
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
          const update = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer)
          docManager.applyUpdate(client.docId, update)

          // Broadcast to all other clients in the same doc
          for (const [otherWs, otherClient] of clients) {
            if (otherClient.docId === client.docId && otherWs !== rawWs) {
              try { otherWs.send(update) } catch {}
            }
          }
        }
      },

      onClose(evt, ws) {
        clients.delete(ws.raw as WebSocket)
      },
    }
  }))

  return { injectWebSocket }
}
```

- [ ] **Step 7: Wire WebSocket into server entry**

Update `packages/server/src/index.ts` to include:

```ts
// Add to imports
import { DocManager } from './yjs/doc-manager.js'
import { setupWebSocket } from './yjs/ws-handler.js'

// After app creation
const docManager = new DocManager()
const { injectWebSocket } = setupWebSocket(app, docManager)

// Change serve() call
const server = serve({ fetch: app.fetch, port: config.PORT })
injectWebSocket(server)
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: yjs doc manager + websocket handler for real-time collab"
```

---

## Task 5: Document CRUD REST API

**Files:**
- Create: `packages/server/src/routes/documents.ts`
- Create: `packages/server/src/routes/api-keys.ts`
- Modify: `packages/server/src/index.ts` (mount routes)
- Test: `packages/server/tests/agent-api.test.ts`

- [ ] **Step 1: Write document CRUD routes**

```ts
// packages/server/src/routes/documents.ts
import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware.js'
import { sql } from '../db/client.js'

export const documentRoutes = new Hono()

documentRoutes.use('*', requireAuth)

// List user's documents (owned + collaborating)
documentRoutes.get('/', async (c) => {
  const { userId } = c.get('user')
  const docs = await sql`
    SELECT d.id, d.title, d.created_at, d.updated_at, d.owner_id
    FROM documents d
    LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${userId}
    WHERE d.owner_id = ${userId} OR dc.user_id IS NOT NULL
    ORDER BY d.updated_at DESC
  `
  return c.json(docs)
})

// Create document
documentRoutes.post('/', async (c) => {
  const { userId } = c.get('user')
  const { title } = await c.req.json<{ title?: string }>()
  const [doc] = await sql`
    INSERT INTO documents (title, owner_id)
    VALUES (${title || 'Untitled'}, ${userId})
    RETURNING *
  `
  return c.json(doc, 201)
})

// Get document
documentRoutes.get('/:id', async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  const [doc] = await sql`
    SELECT d.* FROM documents d
    LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${userId}
    WHERE d.id = ${docId} AND (d.owner_id = ${userId} OR dc.user_id IS NOT NULL)
  `
  if (!doc) return c.json({ error: 'Not found' }, 404)
  return c.json(doc)
})

// Update document title
documentRoutes.patch('/:id', async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  const { title } = await c.req.json<{ title: string }>()
  const [doc] = await sql`
    UPDATE documents SET title = ${title}, updated_at = now()
    WHERE id = ${docId} AND owner_id = ${userId}
    RETURNING *
  `
  if (!doc) return c.json({ error: 'Not found or not owner' }, 404)
  return c.json(doc)
})

// Delete document
documentRoutes.delete('/:id', async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  await sql`DELETE FROM documents WHERE id = ${docId} AND owner_id = ${userId}`
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Write API key management routes**

```ts
// packages/server/src/routes/api-keys.ts
import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware.js'
import { sql } from '../db/client.js'
import { nanoid } from 'nanoid'

export const apiKeyRoutes = new Hono()

apiKeyRoutes.use('*', requireAuth)

// List keys (no hash exposed)
apiKeyRoutes.get('/', async (c) => {
  const { userId } = c.get('user')
  const keys = await sql`
    SELECT id, label, created_at, last_used
    FROM api_keys WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
  return c.json(keys)
})

// Create key — returns plaintext ONCE
apiKeyRoutes.post('/', async (c) => {
  const { userId } = c.get('user')
  const { label } = await c.req.json<{ label?: string }>()
  const plainKey = `pcc_${nanoid(32)}`

  const [key] = await sql`
    INSERT INTO api_keys (user_id, key_hash, label)
    VALUES (${userId}, crypt(${plainKey}, gen_salt('bf')), ${label || 'default'})
    RETURNING id, label, created_at
  `
  return c.json({ ...key, key: plainKey }, 201)
})

// Delete key
apiKeyRoutes.delete('/:id', async (c) => {
  const { userId } = c.get('user')
  const keyId = c.req.param('id')
  await sql`DELETE FROM api_keys WHERE id = ${keyId} AND user_id = ${userId}`
  return c.json({ ok: true })
})
```

- [ ] **Step 3: Mount routes in server entry**

Add to `packages/server/src/index.ts`:

```ts
import { documentRoutes } from './routes/documents.js'
import { apiKeyRoutes } from './routes/api-keys.js'

app.route('/api/documents', documentRoutes)
app.route('/api/keys', apiKeyRoutes)
```

- [ ] **Step 4: Write test for agent REST API**

```ts
// packages/server/tests/agent-api.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from '../src/db/client.js'
import { migrate } from '../src/db/migrate.js'
import { signJwt } from '../src/auth/jwt.js'

let testUserId: string
let testToken: string

beforeAll(async () => {
  await migrate()
  const [user] = await sql`
    INSERT INTO users (email, name, auth_provider)
    VALUES ('agent-test@example.com', 'Agent Tester', 'magic')
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING *
  `
  testUserId = user.id
  testToken = signJwt({ userId: user.id, email: user.email })
})

describe('document API', () => {
  it('creates and lists documents', async () => {
    // Create
    const createRes = await fetch('http://localhost:3000/api/documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${testToken}`,
      },
      body: JSON.stringify({ title: 'Test Doc' }),
    })
    expect(createRes.status).toBe(201)
    const doc = await createRes.json()
    expect(doc.title).toBe('Test Doc')

    // List
    const listRes = await fetch('http://localhost:3000/api/documents', {
      headers: { Cookie: `session=${testToken}` },
    })
    const docs = await listRes.json()
    expect(docs.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `cd packages/server && pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: document CRUD + API key management REST endpoints"
```

---

## Task 6: Snapshot Store + Version History

**Files:**
- Create: `packages/server/src/yjs/snapshot-store.ts`
- Create: `packages/server/src/routes/snapshots.ts`
- Modify: `packages/server/src/yjs/ws-handler.ts` (auto-snapshot on edits)
- Test: `packages/server/tests/snapshot-store.test.ts`

- [ ] **Step 1: Write failing test for snapshot store**

```ts
// packages/server/tests/snapshot-store.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { PostgresSnapshotStore } from '../src/yjs/snapshot-store.js'
import { sql } from '../src/db/client.js'
import { migrate } from '../src/db/migrate.js'

let store: PostgresSnapshotStore
let testDocId: string

beforeAll(async () => {
  await migrate()
  store = new PostgresSnapshotStore()
  const [user] = await sql`
    INSERT INTO users (email, auth_provider) VALUES ('snap-test@test.com', 'magic')
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING *
  `
  const [doc] = await sql`
    INSERT INTO documents (title, owner_id) VALUES ('Snap Test', ${user.id}) RETURNING *
  `
  testDocId = doc.id
})

describe('PostgresSnapshotStore', () => {
  it('saves and loads a snapshot', async () => {
    const data = new Uint8Array([1, 2, 3, 4])
    await store.save(testDocId, data, { authorId: 'user-1', authorType: 'human', description: 'test' })
    const loaded = await store.load(testDocId)
    expect(loaded).toEqual(data)
  })

  it('lists snapshots in reverse chronological order', async () => {
    const data2 = new Uint8Array([5, 6, 7, 8])
    await store.save(testDocId, data2, { authorId: 'claude', authorType: 'agent', description: 'agent edit' })
    const list = await store.list(testDocId)
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(list[0].authorType).toBe('agent')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- snapshot-store`
Expected: FAIL

- [ ] **Step 3: Implement snapshot store**

```ts
// packages/server/src/yjs/snapshot-store.ts
import { sql } from '../db/client.js'

export interface SnapshotMeta {
  id: string
  authorId: string
  authorType: 'human' | 'agent'
  description: string | null
  createdAt: Date
}

export interface SnapshotStore {
  save(docId: string, data: Uint8Array, meta: { authorId: string; authorType: string; description?: string }): Promise<void>
  load(docId: string): Promise<Uint8Array | null>
  list(docId: string): Promise<SnapshotMeta[]>
  loadById(snapshotId: string): Promise<Uint8Array | null>
}

export class PostgresSnapshotStore implements SnapshotStore {
  async save(docId: string, data: Uint8Array, meta: { authorId: string; authorType: string; description?: string }): Promise<void> {
    await sql`
      INSERT INTO document_snapshots (document_id, author_id, author_type, yjs_snapshot, description)
      VALUES (${docId}, ${meta.authorId}, ${meta.authorType}, ${Buffer.from(data)}, ${meta.description || null})
    `
    // Also update the main document's yjs_state
    await sql`
      UPDATE documents SET yjs_state = ${Buffer.from(data)}, updated_at = now()
      WHERE id = ${docId}
    `
  }

  async load(docId: string): Promise<Uint8Array | null> {
    const [row] = await sql`
      SELECT yjs_snapshot FROM document_snapshots
      WHERE document_id = ${docId}
      ORDER BY created_at DESC LIMIT 1
    `
    if (!row) return null
    return new Uint8Array(row.yjs_snapshot)
  }

  async loadById(snapshotId: string): Promise<Uint8Array | null> {
    const [row] = await sql`SELECT yjs_snapshot FROM document_snapshots WHERE id = ${snapshotId}`
    if (!row) return null
    return new Uint8Array(row.yjs_snapshot)
  }

  async list(docId: string): Promise<SnapshotMeta[]> {
    const rows = await sql`
      SELECT id, author_id, author_type, description, created_at
      FROM document_snapshots
      WHERE document_id = ${docId}
      ORDER BY created_at DESC
    `
    return rows.map(r => ({
      id: r.id,
      authorId: r.author_id,
      authorType: r.author_type,
      description: r.description,
      createdAt: r.created_at,
    }))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- snapshot-store`
Expected: PASS

- [ ] **Step 5: Add snapshot REST routes**

```ts
// packages/server/src/routes/snapshots.ts
import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware.js'
import { PostgresSnapshotStore } from '../yjs/snapshot-store.js'

const store = new PostgresSnapshotStore()

export const snapshotRoutes = new Hono()

snapshotRoutes.use('*', requireAuth)

// List snapshots for a document
snapshotRoutes.get('/:docId/snapshots', async (c) => {
  const docId = c.req.param('docId')
  const snapshots = await store.list(docId)
  return c.json(snapshots)
})

// Restore a specific snapshot (creates a new snapshot from old state)
snapshotRoutes.post('/:docId/snapshots/:snapshotId/restore', async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('docId')
  const snapshotId = c.req.param('snapshotId')

  const data = await store.loadById(snapshotId)
  if (!data) return c.json({ error: 'Snapshot not found' }, 404)

  await store.save(docId, data, {
    authorId: userId,
    authorType: 'human',
    description: `Restored from snapshot ${snapshotId}`,
  })

  return c.json({ ok: true, description: 'Restored' })
})
```

Mount in `index.ts`:
```ts
import { snapshotRoutes } from './routes/snapshots.js'
app.route('/api/documents', snapshotRoutes)
```

- [ ] **Step 6: Add auto-snapshot interval to WebSocket handler**

In `ws-handler.ts`, add a 5-minute auto-save timer per doc:

```ts
// Add to DocManager or ws-handler: schedule periodic snapshots
const snapshotTimers = new Map<string, NodeJS.Timeout>()

function scheduleAutoSnapshot(docId: string, docManager: DocManager, store: PostgresSnapshotStore) {
  if (snapshotTimers.has(docId)) return
  const timer = setInterval(async () => {
    const state = docManager.getState(docId)
    if (state) {
      await store.save(docId, state, { authorId: 'system', authorType: 'human', description: 'auto-save' })
    }
  }, 5 * 60 * 1000)
  snapshotTimers.set(docId, timer)
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: snapshot store + version history API + auto-save"
```

---

## Task 7: @-mention Detection + Agent REST API

**Files:**
- Create: `packages/server/src/yjs/mention-detector.ts`
- Create: `packages/server/src/routes/agent.ts`
- Modify: `packages/server/src/yjs/ws-handler.ts` (hook mention detector)
- Test: `packages/server/tests/mention-detector.test.ts`

- [ ] **Step 1: Write failing test for mention detector**

```ts
// packages/server/tests/mention-detector.test.ts
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { detectMentions } from '../src/yjs/mention-detector.js'

describe('mention detector', () => {
  it('detects @agent-name in text', () => {
    const doc = new Y.Doc()
    const xml = doc.getXmlFragment('default')

    // Simulate a Tiptap mention node structure
    const el = new Y.XmlElement('mention')
    el.setAttribute('label', 'claude')
    el.setAttribute('id', 'claude')
    xml.insert(0, [el])

    const mentions = detectMentions(doc)
    expect(mentions).toHaveLength(1)
    expect(mentions[0].agentName).toBe('claude')
  })

  it('returns empty for no mentions', () => {
    const doc = new Y.Doc()
    doc.getText('content').insert(0, 'Hello world')
    const mentions = detectMentions(doc)
    expect(mentions).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- mention-detector`
Expected: FAIL

- [ ] **Step 3: Implement mention detector**

```ts
// packages/server/src/yjs/mention-detector.ts
import * as Y from 'yjs'

export interface Mention {
  id: string
  agentName: string
  context: string
  timestamp: number
}

export function detectMentions(doc: Y.Doc): Mention[] {
  const mentions: Mention[] = []
  const xml = doc.getXmlFragment('default')

  function walk(node: Y.XmlElement | Y.XmlFragment) {
    if (node instanceof Y.XmlElement && node.nodeName === 'mention') {
      const label = node.getAttribute('label')
      if (label) {
        // Extract surrounding text from parent element
        const parent = (node as any)._parent
        const context = parent ? parent.toString().slice(0, 200) : ''
        mentions.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          agentName: label,
          context,
          timestamp: Date.now(),
        })
      }
    }
    // Walk children
    for (let i = 0; i < (node as any).length; i++) {
      const child = (node as any).get(i)
      if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
        walk(child)
      }
    }
  }

  walk(xml)
  return mentions
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- mention-detector`
Expected: PASS

- [ ] **Step 5: Wire mention detector into ws-handler + Redis queue**

Update `ws-handler.ts` onMessage handler to detect mentions after applying Yjs update:

```ts
// In ws-handler.ts onMessage, after broadcasting:
import { detectMentions } from './mention-detector.js'
import { redis } from '../redis.js'

// After docManager.applyUpdate and broadcast:
const newMentions = detectMentions(docManager.getOrCreate(client.docId))
for (const mention of newMentions) {
  // Queue mention for the targeted agent's owner
  // For MVP, queue for all connected agent owners on this doc
  const mentionData = JSON.stringify({
    ...mention,
    context: extractSurroundingText(docManager.getOrCreate(client.docId), mention),
  })
  await redis.rpush(`mentions:${client.docId}:*`, mentionData)
}
```

Note: The mention detector currently scans the full doc. A production version should diff against previous state to only detect *new* mentions. For the MVP, agents calling `get_mentions` will clear the queue after reading, which is sufficient.

- [ ] **Step 6: Write agent REST API routes**

```ts
// packages/server/src/routes/agent.ts
import { Hono } from 'hono'
import { requireApiKey } from '../auth/middleware.js'
import { sql } from '../db/client.js'
import type { DocManager } from '../yjs/doc-manager.js'
import type { PostgresSnapshotStore } from '../yjs/snapshot-store.js'

import { redis } from '../redis.js'

export function createAgentRoutes(docManager: DocManager, snapshotStore: PostgresSnapshotStore) {
  const agent = new Hono()

  agent.use('*', requireApiKey)

  // List documents accessible to this user
  agent.get('/documents', async (c) => {
    const { userId } = c.get('user')
    const docs = await sql`
      SELECT d.id, d.title, d.updated_at FROM documents d
      LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${userId}
      WHERE d.owner_id = ${userId} OR dc.user_id IS NOT NULL
      ORDER BY d.updated_at DESC
    `
    return c.json(docs)
  })

  // Read document as markdown
  agent.get('/documents/:id', async (c) => {
    const docId = c.req.param('id')
    const content = docManager.getMarkdown(docId)
    return c.json({ id: docId, content })
  })

  // Edit document with anchor-based targeting
  agent.post('/documents/:id/edit', async (c) => {
    const { userId } = c.get('user')
    const docId = c.req.param('id')
    const { anchor, new_content } = await c.req.json<{ anchor: string; new_content: string }>()

    const doc = docManager.getOrCreate(docId)
    const text = doc.getText('content')
    const currentText = text.toString()

    // Find anchor position
    const anchorIdx = currentText.indexOf(anchor)
    if (anchorIdx === -1) {
      return c.json({ error: `Anchor "${anchor}" not found in document` }, 400)
    }

    // Replace anchor text with new content
    doc.transact(() => {
      text.delete(anchorIdx, anchor.length)
      text.insert(anchorIdx, new_content)
    })

    // Save agent snapshot
    const state = docManager.getState(docId)
    if (state) {
      await snapshotStore.save(docId, state, {
        authorId: userId,
        authorType: 'agent',
        description: 'agent edit',
      })
    }

    return c.json({ ok: true })
  })

  // Get unread mentions (reads from Redis list, populated by mention detector in ws-handler)
  agent.get('/documents/:id/mentions', async (c) => {
    const docId = c.req.param('id')
    const { userId } = c.get('user')
    const raw = await redis.lrange(`mentions:${docId}:${userId}`, 0, -1)
    const mentions = raw.map(r => JSON.parse(r))
    // Clear after reading
    if (raw.length > 0) await redis.del(`mentions:${docId}:${userId}`)
    return c.json(mentions)
  })

  // Respond to mention
  agent.post('/documents/:id/mentions/:mentionId/respond', async (c) => {
    const docId = c.req.param('id')
    const { content } = await c.req.json<{ content: string }>()

    const doc = docManager.getOrCreate(docId)
    const text = doc.getText('content')
    text.insert(text.length, `\n\n${content}`)

    return c.json({ ok: true })
  })

  // Get presence
  agent.get('/documents/:id/presence', async (c) => {
    // TODO: read from Redis
    return c.json([])
  })

  return agent
}
```

- [ ] **Step 6: Mount agent routes in index.ts**

```ts
import { createAgentRoutes } from './routes/agent.js'

const agentRoutes = createAgentRoutes(docManager, new PostgresSnapshotStore())
app.route('/api/agent', agentRoutes)
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: mention detection + agent REST API (list/read/edit/mentions/presence)"
```

---

## Task 8: Presence Tracker (Redis)

**Files:**
- Create: `packages/server/src/presence/tracker.ts`
- Modify: `packages/server/src/yjs/ws-handler.ts` (track presence on connect/disconnect)
- Modify: `packages/server/src/routes/agent.ts` (wire presence endpoint)

- [ ] **Step 1: Implement presence tracker**

```ts
// packages/server/src/presence/tracker.ts
import { redis } from '../redis.js'

export interface PresenceInfo {
  userId: string
  name: string
  isAgent: boolean
  color: string
  connectedAt: number
}

const PRESENCE_TTL = 60 // seconds, refreshed on activity

const COLORS = ['#4a9eff', '#f0c040', '#50c878', '#c850c8', '#ff6b6b', '#ffa040']

export class PresenceTracker {
  private colorIdx = 0

  private nextColor(): string {
    return COLORS[this.colorIdx++ % COLORS.length]
  }

  async join(docId: string, userId: string, name: string, isAgent: boolean): Promise<PresenceInfo> {
    const info: PresenceInfo = {
      userId,
      name,
      isAgent,
      color: this.nextColor(),
      connectedAt: Date.now(),
    }
    await redis.hset(`presence:${docId}`, userId, JSON.stringify(info))
    await redis.expire(`presence:${docId}`, PRESENCE_TTL)
    return info
  }

  async leave(docId: string, userId: string): Promise<void> {
    await redis.hdel(`presence:${docId}`, userId)
  }

  async list(docId: string): Promise<PresenceInfo[]> {
    const all = await redis.hgetall(`presence:${docId}`)
    return Object.values(all).map(v => JSON.parse(v))
  }

  async heartbeat(docId: string, userId: string): Promise<void> {
    await redis.expire(`presence:${docId}`, PRESENCE_TTL)
  }
}
```

- [ ] **Step 2: Wire presence into WebSocket handler**

Update `ws-handler.ts` onOpen/onClose to call `presenceTracker.join()` / `presenceTracker.leave()`.

- [ ] **Step 3: Wire presence into agent route**

Update `/api/agent/documents/:id/presence` to call `presenceTracker.list(docId)`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: redis-backed presence tracking for users and agents"
```

---

## Task 9: React Frontend — Login + Dashboard

**Files:**
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/api.ts`
- Create: `packages/web/src/hooks/useAuth.ts`
- Create: `packages/web/src/pages/Login.tsx`
- Create: `packages/web/src/pages/Dashboard.tsx`
- Create: `packages/web/src/styles/globals.css`

- [ ] **Step 1: Create React entry + router**

```tsx
// packages/web/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
```

```tsx
// packages/web/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Editor } from './pages/Editor'
import { Settings } from './pages/Settings'
import { useAuth } from './hooks/useAuth'

export function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading">Loading...</div>

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" />} />
        <Route path="/d/:docId" element={user ? <Editor /> : <Navigate to="/login" />} />
        <Route path="/settings" element={user ? <Settings /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 2: Create API client + auth hook**

```ts
// packages/web/src/api.ts
export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}
```

```ts
// packages/web/src/hooks/useAuth.ts
import { useState, useEffect } from 'react'
import { api } from '../api'

interface User { userId: string; email: string; name?: string }

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])

  return { user, loading }
}
```

- [ ] **Step 3: Create Login page**

```tsx
// packages/web/src/pages/Login.tsx
import { useState } from 'react'
import { api } from '../api'

export function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  const sendMagicLink = async () => {
    await api('/auth/magic/send', { method: 'POST', body: JSON.stringify({ email }) })
    setSent(true)
  }

  return (
    <div className="login-page">
      <h1>paired.cc</h1>
      <p>Collaborative documents with AI agents</p>
      <div className="login-buttons">
        <a href="/auth/github/login" className="btn btn-github">Sign in with GitHub</a>
        <a href="/auth/google/login" className="btn btn-google">Sign in with Google</a>
        <div className="divider">or</div>
        {sent ? (
          <p>Check your email for a login link.</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); sendMagicLink() }}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" className="input" />
            <button type="submit" className="btn btn-magic">Send magic link</button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create Dashboard page**

```tsx
// packages/web/src/pages/Dashboard.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

interface Doc { id: string; title: string; updated_at: string }

export function Dashboard() {
  const [docs, setDocs] = useState<Doc[]>([])
  const navigate = useNavigate()

  useEffect(() => { api('/api/documents').then(setDocs) }, [])

  const createDoc = async () => {
    const doc = await api('/api/documents', { method: 'POST', body: JSON.stringify({}) })
    navigate(`/d/${doc.id}`)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>paired.cc</h1>
        <div>
          <button onClick={createDoc} className="btn btn-primary">New Document</button>
          <a href="/settings" className="btn btn-ghost">Settings</a>
        </div>
      </header>
      <div className="doc-list">
        {docs.map(doc => (
          <a key={doc.id} href={`/d/${doc.id}`} className="doc-card">
            <h3>{doc.title}</h3>
            <time>{new Date(doc.updated_at).toLocaleDateString()}</time>
          </a>
        ))}
        {docs.length === 0 && <p className="empty">No documents yet. Create one to get started.</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create base styles (dark theme)**

```css
/* packages/web/src/styles/globals.css */
:root {
  --bg: #0a0a0a;
  --surface: #111;
  --border: #2a2a2a;
  --text: #eee;
  --text-muted: #888;
  --primary: #4a9eff;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
}

.btn {
  display: inline-block;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  text-decoration: none;
  font-size: 14px;
}
.btn-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.btn-ghost { background: transparent; border: none; color: var(--text-muted); }

.input {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  width: 100%;
}

.login-page {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: 100vh; gap: 16px;
}
.login-buttons { display: flex; flex-direction: column; gap: 12px; width: 300px; }
.divider { text-align: center; color: var(--text-muted); font-size: 13px; }

.dashboard { max-width: 800px; margin: 0 auto; padding: 40px 24px; }
.dashboard-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.doc-list { display: flex; flex-direction: column; gap: 8px; }
.doc-card {
  display: block; padding: 16px; border: 1px solid var(--border);
  border-radius: 8px; text-decoration: none; color: var(--text);
}
.doc-card:hover { border-color: var(--primary); }
.doc-card h3 { margin-bottom: 4px; }
.doc-card time { font-size: 13px; color: var(--text-muted); }
.empty { color: var(--text-muted); text-align: center; padding: 40px; }
.loading { display: flex; align-items: center; justify-content: center; min-height: 100vh; color: var(--text-muted); }
```

- [ ] **Step 6: Create placeholder pages**

```tsx
// packages/web/src/pages/Editor.tsx
export function Editor() {
  return <div>Editor — will be built in Task 10</div>
}
```

```tsx
// packages/web/src/pages/Settings.tsx
export function Settings() {
  return <div>Settings — will be built in Task 12</div>
}
```

- [ ] **Step 7: Verify frontend builds**

Run: `cd packages/web && pnpm dev`
Expected: Vite dev server starts, login page renders at `http://localhost:5173`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: react frontend — login page + dashboard + routing + dark theme"
```

---

## Task 10: Editor Page — Tiptap + Yjs Collaboration

**Files:**
- Create: `packages/web/src/components/editor/TiptapEditor.tsx`
- Create: `packages/web/src/components/editor/MentionList.tsx`
- Create: `packages/web/src/components/editor/CursorPresence.tsx`
- Create: `packages/web/src/components/TopBar.tsx`
- Create: `packages/web/src/components/PresenceAvatars.tsx`
- Create: `packages/web/src/hooks/useDocument.ts`
- Create: `packages/web/src/hooks/usePresence.ts`
- Modify: `packages/web/src/pages/Editor.tsx`

- [ ] **Step 1: Create useDocument hook (Yjs + WebSocket)**

```tsx
// packages/web/src/hooks/useDocument.ts
import { useState, useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { api } from '../api'

interface DocMeta { id: string; title: string }

export function useDocument(docId: string) {
  const [doc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [meta, setMeta] = useState<DocMeta | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    api(`/api/documents/${docId}`).then(setMeta)

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/${docId}`
    const prov = new WebsocketProvider(wsUrl, docId, doc)
    prov.on('status', ({ status }: { status: string }) => setConnected(status === 'connected'))
    setProvider(prov)

    return () => { prov.destroy(); doc.destroy() }
  }, [docId])

  return { doc, provider, meta, connected }
}
```

- [ ] **Step 2: Create Tiptap editor component**

```tsx
// packages/web/src/components/editor/TiptapEditor.tsx
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Mention from '@tiptap/extension-mention'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { MentionList } from './MentionList'

interface Props {
  doc: Y.Doc
  provider: WebsocketProvider
  userName: string
  userColor: string
}

export function TiptapEditor({ doc, provider, userName, userColor }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: doc }),
      CollaborationCursor.configure({
        provider,
        user: { name: userName, color: userColor },
      }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          items: ({ query }: { query: string }) => {
            // TODO: fetch connected agents + collaborators
            return [
              { id: 'claude', label: 'claude' },
            ].filter(item => item.label.toLowerCase().startsWith(query.toLowerCase()))
          },
          render: () => {
            let component: any
            return {
              onStart: (props: any) => { /* mount MentionList */ },
              onUpdate: (props: any) => { /* update MentionList */ },
              onExit: () => { /* unmount MentionList */ },
              onKeyDown: (props: any) => { /* handle key nav */ },
            }
          },
        },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Link.configure({ openOnClick: false }),
    ],
  })

  return <EditorContent editor={editor} className="tiptap-editor" />
}
```

- [ ] **Step 3: Create presence components**

```tsx
// packages/web/src/hooks/usePresence.ts
import { useState, useEffect } from 'react'
import type { WebsocketProvider } from 'y-websocket'

interface Peer { name: string; color: string; isAgent?: boolean }

export function usePresence(provider: WebsocketProvider | null) {
  const [peers, setPeers] = useState<Peer[]>([])

  useEffect(() => {
    if (!provider) return
    const awareness = provider.awareness
    const update = () => {
      const states = Array.from(awareness.getStates().values())
      setPeers(states.filter(s => s.user).map(s => s.user as Peer))
    }
    awareness.on('change', update)
    update()
    return () => { awareness.off('change', update) }
  }, [provider])

  return peers
}
```

```tsx
// packages/web/src/components/PresenceAvatars.tsx
interface Props {
  peers: { name: string; color: string; isAgent?: boolean }[]
}

export function PresenceAvatars({ peers }: Props) {
  return (
    <div className="presence-avatars">
      {peers.map((p, i) => (
        <div key={i} className="avatar" style={{ background: p.color }} title={p.name}>
          {p.isAgent ? '🤖' : p.name.slice(0, 2).toUpperCase()}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create TopBar component**

```tsx
// packages/web/src/components/TopBar.tsx
import { PresenceAvatars } from './PresenceAvatars'

interface Props {
  title: string
  onTitleChange: (title: string) => void
  peers: { name: string; color: string; isAgent?: boolean }[]
  onShare: () => void
}

export function TopBar({ title, onTitleChange, peers, onShare }: Props) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <a href="/" className="topbar-logo">paired.cc</a>
        <span className="topbar-sep">›</span>
        <input
          className="topbar-title"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
        />
      </div>
      <div className="topbar-right">
        <PresenceAvatars peers={peers} />
        <button className="btn" onClick={onShare}>Share</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire Editor page together**

```tsx
// packages/web/src/pages/Editor.tsx
import { useParams } from 'react-router-dom'
import { useDocument } from '../hooks/useDocument'
import { usePresence } from '../hooks/usePresence'
import { useAuth } from '../hooks/useAuth'
import { TiptapEditor } from '../components/editor/TiptapEditor'
import { TopBar } from '../components/TopBar'

export function Editor() {
  const { docId } = useParams<{ docId: string }>()
  const { user } = useAuth()
  const { doc, provider, meta, connected } = useDocument(docId!)
  const peers = usePresence(provider)

  if (!provider || !meta) return <div className="loading">Loading document...</div>

  return (
    <div className="editor-page">
      <TopBar
        title={meta.title}
        onTitleChange={() => {}}
        peers={peers}
        onShare={() => {}}
      />
      {!connected && <div className="connection-bar">Reconnecting...</div>}
      <div className="editor-container">
        <TiptapEditor
          doc={doc}
          provider={provider}
          userName={user?.name || user?.email || 'Anonymous'}
          userColor="#4a9eff"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Add editor styles**

Append to `globals.css`:

```css
/* Editor */
.editor-page { display: flex; flex-direction: column; height: 100vh; }
.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 16px; border-bottom: 1px solid var(--border); background: #0d0d0d;
}
.topbar-left { display: flex; align-items: center; gap: 12px; }
.topbar-logo { color: var(--primary); font-weight: bold; font-size: 14px; text-decoration: none; }
.topbar-sep { color: var(--text-muted); }
.topbar-title {
  background: transparent; border: none; color: var(--text);
  font-size: 14px; outline: none; width: 300px;
}
.topbar-right { display: flex; align-items: center; gap: 16px; }
.presence-avatars { display: flex; gap: -4px; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: #fff; border: 2px solid var(--bg); margin-left: -6px;
}
.editor-container { flex: 1; overflow-y: auto; }
.tiptap-editor {
  max-width: 720px; margin: 0 auto; padding: 40px 24px;
  min-height: 100%; outline: none;
}
.tiptap-editor .ProseMirror { outline: none; }
.tiptap-editor .ProseMirror p { margin: 0 0 8px; line-height: 1.7; }
.tiptap-editor .ProseMirror h1 { font-size: 28px; margin: 24px 0 16px; }
.tiptap-editor .ProseMirror h2 { font-size: 22px; margin: 20px 0 12px; }
.tiptap-editor .ProseMirror h3 { font-size: 18px; margin: 16px 0 8px; }
.mention { background: rgba(200, 80, 200, 0.15); color: #c850c8; padding: 1px 4px; border-radius: 3px; }
.connection-bar { background: #f0c040; color: #111; text-align: center; padding: 4px; font-size: 13px; }

/* Collaboration cursors */
.collaboration-cursor__caret {
  border-left: 2px solid;
  position: relative;
}
.collaboration-cursor__label {
  position: absolute;
  top: -18px;
  left: 0;
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
  color: #111;
  white-space: nowrap;
  font-weight: bold;
}
```

- [ ] **Step 7: Verify dev server works**

Run: `pnpm dev`
Expected: Frontend at `localhost:5173`, proxies API to `localhost:3000`. Editor page loads with Tiptap.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: tiptap editor with yjs collaboration, cursors, presence, mentions"
```

---

## Task 11: Sharing Dialog + Invite Flow

**Files:**
- Create: `packages/web/src/components/ShareDialog.tsx`
- Create: `packages/server/src/routes/sharing.ts`
- Modify: `packages/server/src/index.ts` (mount sharing routes)
- Modify: `packages/web/src/pages/Editor.tsx` (wire share dialog)

- [ ] **Step 1: Write sharing API routes**

```ts
// packages/server/src/routes/sharing.ts
import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware.js'
import { sql } from '../db/client.js'

export const sharingRoutes = new Hono()

sharingRoutes.use('*', requireAuth)

// List collaborators
sharingRoutes.get('/:docId/collaborators', async (c) => {
  const docId = c.req.param('docId')
  const collabs = await sql`
    SELECT u.id, u.email, u.name, dc.role
    FROM document_collaborators dc JOIN users u ON dc.user_id = u.id
    WHERE dc.document_id = ${docId}
  `
  return c.json(collabs)
})

// Add collaborator by email
sharingRoutes.post('/:docId/collaborators', async (c) => {
  const docId = c.req.param('docId')
  const { email, role } = await c.req.json<{ email: string; role?: string }>()

  // Find or create user
  let [user] = await sql`SELECT * FROM users WHERE email = ${email}`
  if (!user) {
    [user] = await sql`
      INSERT INTO users (email, auth_provider) VALUES (${email}, 'magic') RETURNING *
    `
    // TODO: Send invite email with magic link
  }

  await sql`
    INSERT INTO document_collaborators (document_id, user_id, role)
    VALUES (${docId}, ${user.id}, ${role || 'editor'})
    ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `
  return c.json({ ok: true })
})

// Remove collaborator
sharingRoutes.delete('/:docId/collaborators/:userId', async (c) => {
  const docId = c.req.param('docId')
  const userId = c.req.param('userId')
  await sql`DELETE FROM document_collaborators WHERE document_id = ${docId} AND user_id = ${userId}`
  return c.json({ ok: true })
})
```

Mount: `app.route('/api/documents', sharingRoutes)`

- [ ] **Step 2: Write ShareDialog component**

```tsx
// packages/web/src/components/ShareDialog.tsx
import { useState, useEffect } from 'react'
import { api } from '../api'

interface Props {
  docId: string
  open: boolean
  onClose: () => void
}

export function ShareDialog({ docId, open, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [collabs, setCollabs] = useState<any[]>([])
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    api(`/api/documents/${docId}/collaborators`).then(setCollabs)
    api('/api/keys').then(setApiKeys)
  }, [open, docId])

  const invite = async () => {
    await api(`/api/documents/${docId}/collaborators`, {
      method: 'POST', body: JSON.stringify({ email }),
    })
    setEmail('')
    api(`/api/documents/${docId}/collaborators`).then(setCollabs)
  }

  const createKey = async () => {
    const res = await api('/api/keys', {
      method: 'POST', body: JSON.stringify({ label: 'agent' }),
    })
    setNewKey(res.key)
    api('/api/keys').then(setApiKeys)
  }

  if (!open) return null

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>Share Document</h3>

        <div className="share-section">
          <h4>Invite people</h4>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com" />
            <button className="btn btn-primary" onClick={invite}>Invite</button>
          </div>
          {collabs.map(c => (
            <div key={c.id} className="collab-row">
              <span>{c.name || c.email}</span>
              <span className="badge">{c.role}</span>
            </div>
          ))}
        </div>

        <div className="share-section">
          <h4>Agent API Key</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Connect Claude Code, Claude Desktop, or any MCP client.
          </p>
          {newKey && (
            <div className="key-display">
              <code>{newKey}</code>
              <p style={{ color: '#f0c040', fontSize: 12 }}>Copy this now — it won't be shown again.</p>
            </div>
          )}
          <button className="btn" onClick={createKey}>Generate new key</button>
          {apiKeys.map(k => (
            <div key={k.id} className="collab-row">
              <span>{k.label}</span>
              <span className="badge">{k.last_used ? `Used ${new Date(k.last_used).toLocaleDateString()}` : 'Never used'}</span>
            </div>
          ))}
        </div>

        <button className="btn btn-ghost" onClick={onClose} style={{ marginTop: 16 }}>Close</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add dialog styles to globals.css**

```css
/* Dialog */
.dialog-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.dialog {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 24px; width: 420px; max-height: 80vh; overflow-y: auto;
}
.share-section { margin: 20px 0; }
.share-section h4 { margin-bottom: 8px; }
.collab-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0; border-bottom: 1px solid var(--border);
}
.badge {
  font-size: 11px; padding: 2px 8px; background: var(--border);
  border-radius: 4px; color: var(--text-muted);
}
.key-display {
  background: #1a1a2e; padding: 12px; border-radius: 6px;
  margin: 8px 0; word-break: break-all;
}
.key-display code { color: var(--primary); font-size: 13px; }
```

- [ ] **Step 4: Wire share dialog into Editor page**

Update `Editor.tsx` to add share dialog state and pass `onShare` to TopBar.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: share dialog with invite by email + agent API key creation"
```

---

## Task 12: Version History Sidebar

**Files:**
- Create: `packages/web/src/components/VersionHistory.tsx`
- Modify: `packages/web/src/pages/Editor.tsx` (add sidebar toggle)

- [ ] **Step 1: Create VersionHistory component**

```tsx
// packages/web/src/components/VersionHistory.tsx
import { useState, useEffect } from 'react'
import { api } from '../api'

interface Snapshot {
  id: string
  authorId: string
  authorType: 'human' | 'agent'
  description: string | null
  createdAt: string
}

interface Props {
  docId: string
  open: boolean
  onClose: () => void
}

export function VersionHistory({ docId, open, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])

  useEffect(() => {
    if (!open) return
    api(`/api/documents/${docId}/snapshots`).then(setSnapshots)
  }, [open, docId])

  const restore = async (snapshotId: string) => {
    await api(`/api/documents/${docId}/snapshots/${snapshotId}/restore`, { method: 'POST' })
    // Yjs will receive the update via WebSocket
    onClose()
  }

  if (!open) return null

  return (
    <div className="version-sidebar">
      <div className="version-header">
        <h3>Version History</h3>
        <button className="btn btn-ghost" onClick={onClose}>×</button>
      </div>
      <div className="version-list">
        {snapshots.map(s => (
          <div key={s.id} className="version-item">
            <div className="version-meta">
              <span className={`version-author ${s.authorType}`}>
                {s.authorType === 'agent' ? '🤖' : '👤'} {s.authorId}
              </span>
              <time>{new Date(s.createdAt).toLocaleString()}</time>
            </div>
            {s.description && <p className="version-desc">{s.description}</p>}
            <button className="btn btn-ghost" onClick={() => restore(s.id)}>Restore</button>
          </div>
        ))}
        {snapshots.length === 0 && <p className="empty">No snapshots yet.</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add sidebar styles**

```css
.version-sidebar {
  position: fixed; right: 0; top: 0; bottom: 0; width: 320px;
  background: var(--surface); border-left: 1px solid var(--border);
  z-index: 50; overflow-y: auto;
}
.version-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px; border-bottom: 1px solid var(--border);
}
.version-list { padding: 8px; }
.version-item {
  padding: 12px; border-bottom: 1px solid var(--border);
}
.version-meta { display: flex; justify-content: space-between; font-size: 13px; }
.version-meta time { color: var(--text-muted); }
.version-author.agent { color: #50c878; }
.version-author.human { color: var(--primary); }
.version-desc { font-size: 12px; color: var(--text-muted); margin: 4px 0; }
```

- [ ] **Step 3: Wire into Editor page**

Add version history toggle button to TopBar and state in Editor.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: version history sidebar with snapshot list and restore"
```

---

## Task 13: MCP Server Package

**Files:**
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/index.ts`
- Create: `packages/mcp-server/src/tools.ts`
- Create: `packages/mcp-server/src/client.ts`
- Test: `packages/mcp-server/tests/tools.test.ts`

- [ ] **Step 1: Create MCP server package**

```json
// packages/mcp-server/package.json
{
  "name": "@pairedcc/mcp-server",
  "version": "0.0.1",
  "type": "module",
  "bin": { "pairedcc-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1",
    "yjs": "^13"
  },
  "devDependencies": {
    "tsup": "^8",
    "vitest": "^2",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Write HTTP+WS client for paired.cc server**

```ts
// packages/mcp-server/src/client.ts
export class PairedClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private headers() {
    return { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' }
  }

  async listDocuments() {
    const res = await fetch(`${this.baseUrl}/api/agent/documents`, { headers: this.headers() })
    return res.json()
  }

  async readDocument(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}`, { headers: this.headers() })
    return res.json()
  }

  async editDocument(docId: string, anchor: string, newContent: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/edit`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ anchor, new_content: newContent }),
    })
    return res.json()
  }

  async getMentions(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/mentions`, { headers: this.headers() })
    return res.json()
  }

  async respondToMention(docId: string, mentionId: string, content: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/mentions/${mentionId}/respond`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content }),
    })
    return res.json()
  }

  async getPresence(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/presence`, { headers: this.headers() })
    return res.json()
  }
}
```

- [ ] **Step 3: Write MCP tool definitions**

```ts
// packages/mcp-server/src/tools.ts
import { type Tool } from '@modelcontextprotocol/sdk/types.js'

export const tools: Tool[] = [
  {
    name: 'list_documents',
    description: 'List all documents you have access to on paired.cc',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_document',
    description: 'Read the full markdown content of a document',
    inputSchema: {
      type: 'object',
      properties: { doc_id: { type: 'string', description: 'Document ID' } },
      required: ['doc_id'],
    },
  },
  {
    name: 'edit_document',
    description: 'Edit a document. Anchor is a heading or text to find; new_content replaces it.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_id: { type: 'string' },
        anchor: { type: 'string', description: 'Text to find and replace (heading or content)' },
        new_content: { type: 'string', description: 'New content to replace the anchor with' },
      },
      required: ['doc_id', 'anchor', 'new_content'],
    },
  },
  {
    name: 'get_mentions',
    description: 'Get unread @-mentions for this agent in a document',
    inputSchema: {
      type: 'object',
      properties: { doc_id: { type: 'string' } },
      required: ['doc_id'],
    },
  },
  {
    name: 'respond_to_mention',
    description: 'Respond to an @-mention inline in the document',
    inputSchema: {
      type: 'object',
      properties: {
        doc_id: { type: 'string' },
        mention_id: { type: 'string' },
        content: { type: 'string', description: 'Response text to insert' },
      },
      required: ['doc_id', 'mention_id', 'content'],
    },
  },
  {
    name: 'get_presence',
    description: 'See who is currently in a document (humans and agents)',
    inputSchema: {
      type: 'object',
      properties: { doc_id: { type: 'string' } },
      required: ['doc_id'],
    },
  },
]
```

- [ ] **Step 4: Write MCP server entry**

```ts
// packages/mcp-server/src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools } from './tools.js'
import { PairedClient } from './client.js'

const server = new Server({ name: 'pairedcc', version: '0.0.1' }, { capabilities: { tools: {} } })

const client = new PairedClient(
  process.env.PAIREDCC_URL || 'https://paired.cc',
  process.env.PAIREDCC_API_KEY || '',
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  let result: any

  switch (name) {
    case 'list_documents':
      result = await client.listDocuments()
      break
    case 'read_document':
      result = await client.readDocument(args!.doc_id as string)
      break
    case 'edit_document':
      result = await client.editDocument(args!.doc_id as string, args!.anchor as string, args!.new_content as string)
      break
    case 'get_mentions':
      result = await client.getMentions(args!.doc_id as string)
      break
    case 'respond_to_mention':
      result = await client.respondToMention(args!.doc_id as string, args!.mention_id as string, args!.content as string)
      break
    case 'get_presence':
      result = await client.getPresence(args!.doc_id as string)
      break
    default:
      throw new Error(`Unknown tool: ${name}`)
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
```

- [ ] **Step 5: Write tool test**

```ts
// packages/mcp-server/tests/tools.test.ts
import { describe, it, expect } from 'vitest'
import { tools } from '../src/tools.js'

describe('MCP tools', () => {
  it('defines all 6 tools', () => {
    expect(tools).toHaveLength(6)
    const names = tools.map(t => t.name)
    expect(names).toContain('list_documents')
    expect(names).toContain('read_document')
    expect(names).toContain('edit_document')
    expect(names).toContain('get_mentions')
    expect(names).toContain('respond_to_mention')
    expect(names).toContain('get_presence')
  })

  it('edit_document requires doc_id, anchor, and new_content', () => {
    const edit = tools.find(t => t.name === 'edit_document')!
    expect(edit.inputSchema.required).toContain('doc_id')
    expect(edit.inputSchema.required).toContain('anchor')
    expect(edit.inputSchema.required).toContain('new_content')
  })
})
```

- [ ] **Step 6: Run tests**

Run: `cd packages/mcp-server && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: MCP server with 6 tools (list/read/edit/mentions/respond/presence)"
```

---

## Task 14: CLI Package

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/join.ts`
- Create: `packages/cli/src/commands/watch.ts`
- Create: `packages/cli/src/commands/edit.ts`
- Create: `packages/cli/src/client.ts`

- [ ] **Step 1: Create CLI package**

```json
// packages/cli/package.json
{
  "name": "@pairedcc/cli",
  "version": "0.0.1",
  "type": "module",
  "bin": { "pairedcc": "dist/index.js" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run"
  },
  "dependencies": {
    "commander": "^13",
    "yjs": "^13",
    "ws": "^8"
  },
  "devDependencies": {
    "tsup": "^8",
    "vitest": "^2",
    "typescript": "^5",
    "@types/ws": "^8"
  }
}
```

- [ ] **Step 2: Write CLI entry + commands**

```ts
// packages/cli/src/index.ts
#!/usr/bin/env node
import { program } from 'commander'
import { joinCommand } from './commands/join.js'
import { watchCommand } from './commands/watch.js'
import { editCommand } from './commands/edit.js'

program.name('pairedcc').version('0.0.1').description('paired.cc CLI')

program.command('join <doc-id>').description('Join a document as a Yjs peer')
  .option('--key <api-key>', 'API key').option('--url <url>', 'Server URL', 'https://paired.cc')
  .action(joinCommand)

program.command('watch <doc-id>').description('Watch for @-mentions')
  .option('--key <api-key>', 'API key').option('--url <url>', 'Server URL', 'https://paired.cc')
  .action(watchCommand)

program.command('edit <doc-id>').description('Make a one-shot edit')
  .argument('<anchor>', 'Text to find').argument('<content>', 'Replacement content')
  .option('--key <api-key>', 'API key').option('--url <url>', 'Server URL', 'https://paired.cc')
  .action(editCommand)

program.parse()
```

```ts
// packages/cli/src/commands/join.ts
import WebSocket from 'ws'
import * as Y from 'yjs'

export async function joinCommand(docId: string, opts: { key: string; url: string }) {
  const wsUrl = opts.url.replace('http', 'ws') + `/ws/${docId}`
  const doc = new Y.Doc()
  const ws = new WebSocket(wsUrl)

  ws.on('open', () => console.log(`Connected to document ${docId}`))
  ws.on('message', (data: Buffer) => {
    Y.applyUpdate(doc, new Uint8Array(data))
    console.log('Document updated. Current length:', doc.getText('content').toString().length)
  })
  ws.on('close', () => { console.log('Disconnected'); process.exit(0) })
  ws.on('error', (err) => { console.error('Error:', err.message); process.exit(1) })

  // Keep alive
  process.on('SIGINT', () => { ws.close(); process.exit(0) })
}
```

```ts
// packages/cli/src/commands/watch.ts
import { PairedClient } from '../client.js'

export async function watchCommand(docId: string, opts: { key: string; url: string }) {
  const client = new PairedClient(opts.url, opts.key)
  console.log(`Watching for @-mentions in document ${docId}...`)

  // Poll every 5 seconds
  setInterval(async () => {
    const mentions = await client.getMentions(docId)
    for (const m of mentions) {
      console.log(`@${m.agentName}: ${m.context}`)
    }
  }, 5000)
}
```

```ts
// packages/cli/src/commands/edit.ts
import { PairedClient } from '../client.js'

export async function editCommand(docId: string, anchor: string, content: string, opts: { key: string; url: string }) {
  const client = new PairedClient(opts.url, opts.key)
  const result = await client.editDocument(docId, anchor, content)
  console.log(result.ok ? 'Edit applied.' : `Error: ${result.error}`)
}
```

```ts
// packages/cli/src/client.ts
// Copy of PairedClient — same as mcp-server/src/client.ts
// Kept in sync manually for MVP. Extract to shared package if divergence occurs.
export class PairedClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  private headers() {
    return { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' }
  }

  async listDocuments() {
    const res = await fetch(`${this.baseUrl}/api/agent/documents`, { headers: this.headers() })
    return res.json()
  }

  async readDocument(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}`, { headers: this.headers() })
    return res.json()
  }

  async editDocument(docId: string, anchor: string, newContent: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/edit`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ anchor, new_content: newContent }),
    })
    return res.json()
  }

  async getMentions(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/mentions`, { headers: this.headers() })
    return res.json()
  }

  async respondToMention(docId: string, mentionId: string, content: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/mentions/${mentionId}/respond`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ content }),
    })
    return res.json()
  }

  async getPresence(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/presence`, { headers: this.headers() })
    return res.json()
  }
}
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/cli && pnpm build`
Expected: Builds to `dist/index.js`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: pairedcc CLI (join, watch, edit commands)"
```

---

## Task 15: Settings Page (API Key Management)

**Files:**
- Modify: `packages/web/src/pages/Settings.tsx`

- [ ] **Step 1: Implement Settings page**

```tsx
// packages/web/src/pages/Settings.tsx
import { useState, useEffect } from 'react'
import { api } from '../api'

interface ApiKey { id: string; label: string; created_at: string; last_used: string | null }

export function Settings() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [label, setLabel] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)

  const loadKeys = () => api('/api/keys').then(setKeys)
  useEffect(() => { loadKeys() }, [])

  const create = async () => {
    const res = await api('/api/keys', { method: 'POST', body: JSON.stringify({ label: label || 'default' }) })
    setNewKey(res.key)
    setLabel('')
    loadKeys()
  }

  const revoke = async (id: string) => {
    await api(`/api/keys/${id}`, { method: 'DELETE' })
    loadKeys()
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Settings</h1>
        <a href="/" className="btn btn-ghost">← Back</a>
      </header>

      <h2>API Keys</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
        Use these to connect AI agents (Claude Code, Claude Desktop, ChatGPT, etc.)
      </p>

      {newKey && (
        <div className="key-display" style={{ marginBottom: 16 }}>
          <code>{newKey}</code>
          <p style={{ color: '#f0c040', fontSize: 12, marginTop: 8 }}>
            Copy this now — it won't be shown again.
          </p>
          <pre style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{`// Claude Code settings.json
{
  "mcpServers": {
    "pairedcc": {
      "command": "pairedcc-mcp",
      "env": {
        "PAIREDCC_URL": "https://paired.cc",
        "PAIREDCC_API_KEY": "${newKey}"
      }
    }
  }
}`}</pre>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input className="input" value={label} onChange={e => setLabel(e.target.value)}
          placeholder="Label (e.g. claude-code)" style={{ width: 250 }} />
        <button className="btn btn-primary" onClick={create}>Create Key</button>
      </div>

      {keys.map(k => (
        <div key={k.id} className="collab-row">
          <div>
            <strong>{k.label}</strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
              Created {new Date(k.created_at).toLocaleDateString()}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="badge">
              {k.last_used ? `Used ${new Date(k.last_used).toLocaleDateString()}` : 'Never used'}
            </span>
            <button className="btn btn-ghost" style={{ color: '#ff6b6b' }} onClick={() => revoke(k.id)}>
              Revoke
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: settings page with API key management + MCP config snippet"
```

---

## Task 16: E2E Test — Full Flow

**Files:**
- Create: `e2e/package.json`, `e2e/playwright.config.ts`
- Create: `e2e/tests/editor-collab.spec.ts`

- [ ] **Step 1: Set up Playwright**

```json
// e2e/package.json
{
  "name": "@pairedcc/e2e",
  "private": true,
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1"
  }
}
```

```ts
// e2e/playwright.config.ts
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
```

- [ ] **Step 2: Write E2E collaboration test**

```ts
// e2e/tests/editor-collab.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Document collaboration', () => {
  test('two users can edit the same document', async ({ browser, request }) => {
    // Create test users via magic link flow (bypass email, use verify endpoint directly)
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()

    // User 1: send magic link and verify
    await request.post('/auth/magic/send', { data: { email: 'user1@test.com' } })
    // In test mode, the token is logged to console. For E2E, seed a known token or
    // directly set a JWT cookie:
    const jwt1 = await request.fetch('/auth/magic/verify?token=test-token-1')
    const cookies1 = jwt1.headers()['set-cookie']
    // Apply session cookie to ctx1
    await ctx1.addCookies([{ name: 'session', value: extractCookieValue(cookies1), domain: 'localhost', path: '/' }])

    // Repeat for user 2
    await request.post('/auth/magic/send', { data: { email: 'user2@test.com' } })
    const jwt2 = await request.fetch('/auth/magic/verify?token=test-token-2')
    const cookies2 = jwt2.headers()['set-cookie']
    await ctx2.addCookies([{ name: 'session', value: extractCookieValue(cookies2), domain: 'localhost', path: '/' }])

    // User 1 creates a document
    const page1 = await ctx1.newPage()
    await page1.goto('/')
    await page1.click('text=New Document')
    await page1.waitForURL(/\/d\//)
    const docUrl = page1.url()

    // User 2 opens the same document
    const page2 = await ctx2.newPage()
    await page2.goto(docUrl)

    // User 1 types text
    await page1.locator('.ProseMirror').click()
    await page1.keyboard.type('Hello from user 1')

    // Verify text appears in user 2's editor
    await expect(page2.locator('.ProseMirror')).toContainText('Hello from user 1', { timeout: 5000 })

    // Verify presence shows 2 avatars
    await expect(page1.locator('.avatar')).toHaveCount(2, { timeout: 3000 })

    await ctx1.close()
    await ctx2.close()
  })
})

function extractCookieValue(setCookie: string): string {
  return setCookie.split(';')[0].split('=')[1]
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: e2e test scaffold with playwright"
```

---

## Task 17: Docker Build + Deploy Config

**Files:**
- Modify: `Dockerfile` (finalize)
- Create: `docker-compose.prod.yml`
- Create: `.github/workflows/deploy.yml` (optional)

- [ ] **Step 1: Create production docker-compose**

```yaml
# docker-compose.prod.yml
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: pairedcc
      POSTGRES_USER: pairedcc
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: ["pgdata:/var/lib/postgresql/data"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pairedcc"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped

volumes:
  pgdata:
```

- [ ] **Step 2: Test full Docker build**

Run: `docker compose build`
Expected: Builds successfully

Run: `docker compose up -d`
Expected: All three containers start, app accessible at `localhost:3000`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: production docker compose config"
```

---

**Plan complete and saved to `docs/superpowers/plans/2026-03-23-paired-cc-mvp.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
