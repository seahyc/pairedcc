import { Hono } from 'hono'
import { requireApiKey } from '../auth/middleware.js'
import { sql } from '../db/client.js'
import type { DocManager } from '../yjs/doc-manager.js'
import type { PostgresSnapshotStore } from '../yjs/snapshot-store.js'
import type { PresenceTracker } from '../presence/tracker.js'
import { redis } from '../redis.js'
import { docAwarenesses } from '../yjs/ws-handler.js'
import * as Y from 'yjs'

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
    const doc = docManager.getOrCreate(docId)
    // Debug: list all shared types in the doc
    const sharedTypes: Record<string, string> = {}
    for (const [key, type] of doc.share.entries()) {
      sharedTypes[key] = `${type.constructor.name}(length=${(type as any).length || 0})`
    }
    const content = docManager.getMarkdown(docId)
    return c.json({ id: docId, content, _debug: sharedTypes })
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

  // Stream-type into document (character by character, with agent cursor)
  agent.post('/documents/:id/stream', async (c) => {
    const { userId } = c.get('user')
    const docId = c.req.param('id')
    const { content, agent_name, speed } = await c.req.json<{ content: string; agent_name?: string; speed?: number }>()
    const charDelay = speed || 8 // ms per character (fast, like watching an LLM stream)

    const doc = docManager.getOrCreate(docId)

    // Find the XML fragment
    let xml: Y.XmlFragment | null = null
    for (const [key, type] of doc.share.entries()) {
      if (type instanceof Y.XmlFragment && type.length > 0) {
        xml = type as Y.XmlFragment
        break
      }
    }
    if (!xml) xml = doc.getXmlFragment('default')

    // Create a new paragraph for the streamed content
    const p = new Y.XmlElement('paragraph')
    const textNode = new Y.XmlText('')
    doc.transact(() => {
      p.insert(0, [textNode])
      xml!.insert(xml!.length, [p])
    })

    // Set agent cursor via awareness
    const awareness = docAwarenesses.get(docId)
    const agentClientId = 99999 + Math.floor(Math.random() * 10000)
    const colors = ['#50c878', '#ff6b6b', '#ffa040', '#c850c8', '#4a9eff']
    const color = colors[Math.floor(Math.random() * colors.length)]
    const name = agent_name || 'claude'

    // Stream characters
    for (let i = 0; i < content.length; i++) {
      doc.transact(() => {
        textNode.insert(i, content[i])
      })

      // Update awareness to show cursor position (broadcast to browser clients)
      if (awareness) {
        awareness.setLocalStateField('user', {
          name: `🤖 ${name}`,
          color,
        })
      }

      await new Promise(resolve => setTimeout(resolve, charDelay))
    }

    // Clear agent awareness after done
    if (awareness) {
      awareness.setLocalState(null)
    }

    // Save snapshot
    const state = docManager.getState(docId)
    if (state) {
      await snapshotStore.save(docId, state, {
        authorId: name,
        authorType: 'agent',
        description: `streamed: ${content.substring(0, 50)}...`,
      })
    }

    return c.json({ ok: true, chars: content.length })
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
