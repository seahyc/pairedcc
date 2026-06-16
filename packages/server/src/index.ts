import { Hono } from 'hono'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { getRequestListener } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config.js'
import { migrate } from './db/migrate.js'
import { sql } from './db/client.js'
import { authRoutes } from './routes/auth.js'
import { documentRoutes, createPublicDocRoutes } from './routes/documents.js'
import { apiKeyRoutes } from './routes/api-keys.js'
import { snapshotRoutes } from './routes/snapshots.js'
import { sharingRoutes } from './routes/sharing.js'
import { createAgentRoutes } from './routes/agent.js'
import { connectorRoutes, docConnectorRoutes } from './routes/connectors.js'
import { manifestRoutes } from './routes/manifest.js'
import { DocManager } from './yjs/doc-manager.js'
import { attachYjsWebSocket } from './yjs/ws-handler.js'
import { PostgresSnapshotStore } from './yjs/snapshot-store.js'
import { PresenceTracker } from './presence/tracker.js'

import { createNormalizeApiTrailingSlash } from './middleware/trailing-slash.js'

const app = new Hono()

// Normalize trailing slashes on /api/* paths for ALL methods. Hono's built-in
// trimTrailingSlash only redirects GET/HEAD, which leaves a footgun: a natural-
// looking `POST /api/documents/` matched a `use('*')` requireAuth guard from a
// sibling router mounted on the same prefix and returned a misleading 401
// instead of behaving like `POST /api/documents` (anonymous create). This
// middleware rewrites the matched path so the request routes identically with
// or without a trailing slash.
app.use('/api/*', createNormalizeApiTrailingSlash((req) => app.fetch(req)))

const docManager = new DocManager()
const presenceTracker = new PresenceTracker()
const snapshotStore = new PostgresSnapshotStore()

// WebSocket is attached after server starts (see main())

// Auth routes
app.route('/auth', authRoutes)

// API routes
app.route('/api/documents', documentRoutes)
app.route('/api/documents', createPublicDocRoutes(docManager, snapshotStore))
app.route('/api/documents', snapshotRoutes)
app.route('/api/documents', sharingRoutes)
app.route('/api/documents', docConnectorRoutes)
app.route('/api/connectors', connectorRoutes)
app.route('/api/block-kit', manifestRoutes)
app.route('/api/keys', apiKeyRoutes)

// Agent API
const agentRoutes = createAgentRoutes(docManager, snapshotStore, presenceTracker)
app.route('/api/agent', agentRoutes)

// Health check — reports DB + Redis status for uptime monitoring.
app.get('/api/health', async (c) => {
  const health: { ok: boolean; db: 'ok' | string; redis: 'ok' | string; ts: string } = {
    ok: true,
    db: 'ok',
    redis: 'ok',
    ts: new Date().toISOString(),
  }
  try {
    await sql`SELECT 1`
  } catch (e) {
    health.db = (e as Error).message
    health.ok = false
  }
  try {
    const { redis } = await import('./redis.js')
    await redis.ping()
  } catch (e) {
    health.redis = (e as Error).message
    health.ok = false
  }
  return c.json(health, health.ok ? 200 : 503)
})

// Cleanup expired anonymous documents
async function cleanupAnonymousDocs() {
  const result = await sql`
    DELETE FROM documents WHERE is_anonymous = true AND expires_at < now()
  `
  if (result.count > 0) {
    console.log(`Cleaned up ${result.count} expired anonymous documents`)
  }
}

// Serve frontend in production
app.use('/*', serveStatic({ root: './public' }))

// SPA history fallback — for client-side routes (e.g. /d/:id, /settings)
// the file doesn't exist on disk, so serve index.html and let React Router handle it.
// Skips API/auth paths and anything that looks like a static asset (has a file extension).
app.get('*', async (c) => {
  const path = c.req.path
  if (path.startsWith('/api/') || path.startsWith('/auth/') || /\.[a-zA-Z0-9]+$/.test(path)) {
    return c.notFound()
  }
  try {
    const html = await readFile('./public/index.html', 'utf-8')
    return c.html(html)
  } catch {
    return c.notFound()
  }
})

async function main() {
  await migrate()

  // Run cleanup on startup
  await cleanupAnonymousDocs()

  // Schedule cleanup every hour
  setInterval(cleanupAnonymousDocs, 60 * 60 * 1000)

  console.log(`paired.cc server running on port ${config.PORT}`)
  const server = createServer(getRequestListener(app.fetch))
  attachYjsWebSocket(server, docManager)
  server.listen(config.PORT)
}

main()
