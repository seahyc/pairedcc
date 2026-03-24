import { Hono } from 'hono'
import { requireApiKey } from '../auth/middleware.js'
import { sql } from '../db/client.js'
import type { DocManager } from '../yjs/doc-manager.js'
import type { PostgresSnapshotStore } from '../yjs/snapshot-store.js'
import type { PresenceTracker } from '../presence/tracker.js'
import { redis } from '../redis.js'

export function createAgentRoutes(docManager: DocManager, snapshotStore: PostgresSnapshotStore, presenceTracker: PresenceTracker) {
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

    const success = docManager.editByAnchor(docId, anchor, new_content)
    if (!success) {
      return c.json({ error: `Anchor "${anchor}" not found in document` }, 400)
    }

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

  // Get unread mentions
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

    docManager.editByAnchor(docId, '', content)

    return c.json({ ok: true })
  })

  // Get presence
  agent.get('/documents/:id/presence', async (c) => {
    const docId = c.req.param('id')
    const presence = await presenceTracker.list(docId)
    return c.json(presence)
  })

  return agent
}
