import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config.js'
import { migrate } from './db/migrate.js'
import { sql } from './db/client.js'
import { authRoutes } from './routes/auth.js'
import { documentRoutes } from './routes/documents.js'
import { apiKeyRoutes } from './routes/api-keys.js'
import { snapshotRoutes } from './routes/snapshots.js'
import { sharingRoutes } from './routes/sharing.js'
import { createAgentRoutes } from './routes/agent.js'
import { DocManager } from './yjs/doc-manager.js'
import { attachYjsWebSocket } from './yjs/ws-handler.js'
import { PostgresSnapshotStore } from './yjs/snapshot-store.js'
import { PresenceTracker } from './presence/tracker.js'

const app = new Hono()

const docManager = new DocManager()
const presenceTracker = new PresenceTracker()
const snapshotStore = new PostgresSnapshotStore()

// WebSocket is attached after server starts (see main())

// Auth routes
app.route('/auth', authRoutes)

// API routes
app.route('/api/documents', documentRoutes)
app.route('/api/documents', snapshotRoutes)
app.route('/api/documents', sharingRoutes)
app.route('/api/keys', apiKeyRoutes)

// Agent API
const agentRoutes = createAgentRoutes(docManager, snapshotStore, presenceTracker)
app.route('/api/agent', agentRoutes)

// Health check
app.get('/api/health', (c) => c.json({ ok: true }))

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

async function main() {
  await migrate()

  // Run cleanup on startup
  await cleanupAnonymousDocs()

  // Schedule cleanup every hour
  setInterval(cleanupAnonymousDocs, 60 * 60 * 1000)

  console.log(`paired.cc server running on port ${config.PORT}`)
  const server = serve({ fetch: app.fetch, port: config.PORT })
  attachYjsWebSocket(server)
}

main()
