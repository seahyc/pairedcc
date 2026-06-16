import { Hono } from 'hono'
import { requireApiKey } from '../auth/middleware.js'
import { sql } from '../db/client.js'
import type { DocManager } from '../yjs/doc-manager.js'
import type { PostgresSnapshotStore } from '../yjs/snapshot-store.js'
import type { PresenceTracker } from '../presence/tracker.js'
import { redis } from '../redis.js'
import { docAwarenesses } from '../yjs/ws-handler.js'
import * as Y from 'yjs'
import {
  upsertBlock,
  deleteBlock,
  readBlockSnapshot,
  listBlocks,
  generateAnchor,
  isAnchor,
} from '../yjs/blocks.js'
import { isUuid, validateBody, parseTags, safeJson } from '../comments/logic.js'
import {
  getComment,
  insertComment,
  listAgentInbox,
  setStatus,
} from '../comments/store.js'

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

  // ---- ComponentBlock substrate ----

  // List all blocks in a doc
  agent.get('/documents/:id/blocks', async (c) => {
    const docId = c.req.param('id')
    const doc = docManager.getOrCreate(docId)
    return c.json(listBlocks(doc))
  })

  // Read a single block by anchor
  agent.get('/documents/:id/blocks/:anchor', async (c) => {
    const docId = c.req.param('id')
    const anchor = c.req.param('anchor')
    if (!isAnchor(anchor)) return c.json({ error: 'Invalid anchor format' }, 400)
    const doc = docManager.getOrCreate(docId)
    const snap = readBlockSnapshot(doc, anchor)
    if (!snap) return c.json({ error: 'Not found' }, 404)
    return c.json(snap)
  })

  /**
   * Upsert a block. Body: { anchor?, type?, props?, state? }.
   * If `anchor` is omitted, the server generates one and returns it — that's
   * the "create" path. If `anchor` is supplied, fields are merged onto the
   * existing entry (or a new one is created at that anchor).
   *
   * State is shallow-merged into the existing Y.Map so concurrent agent edits
   * to different state fields converge via CRDT.
   */
  agent.post('/documents/:id/blocks/upsert', async (c) => {
    const { userId } = c.get('user')
    const docId = c.req.param('id')
    const body = await c.req.json<{
      anchor?: string
      type?: string
      props?: unknown
      state?: Record<string, unknown>
    }>()

    if (body.anchor && !isAnchor(body.anchor)) {
      return c.json({ error: 'Invalid anchor format. Use generateAnchor() or omit to auto-create.' }, 400)
    }
    // For brand-new blocks, type is required.
    const doc = docManager.getOrCreate(docId)
    const anchor = body.anchor ?? generateAnchor()
    const existing = readBlockSnapshot(doc, anchor)
    if (!existing && !body.type) {
      return c.json({ error: 'New blocks require a `type` field.' }, 400)
    }

    upsertBlock(doc, anchor, {
      type: body.type,
      props: body.props,
      state: body.state,
    })

    // Save snapshot so agent edits persist even if no browser is connected.
    const state = docManager.getState(docId)
    if (state) {
      await snapshotStore.save(docId, state, {
        authorId: userId,
        authorType: 'agent',
        description: `block.upsert ${anchor}`,
      })
    }

    return c.json({ anchor, ...readBlockSnapshot(doc, anchor) })
  })

  // Delete a block
  agent.delete('/documents/:id/blocks/:anchor', async (c) => {
    const { userId } = c.get('user')
    const docId = c.req.param('id')
    const anchor = c.req.param('anchor')
    if (!isAnchor(anchor)) return c.json({ error: 'Invalid anchor format' }, 400)
    const doc = docManager.getOrCreate(docId)
    deleteBlock(doc, anchor)
    const state = docManager.getState(docId)
    if (state) {
      await snapshotStore.save(docId, state, {
        authorId: userId,
        authorType: 'agent',
        description: `block.delete ${anchor}`,
      })
    }
    return c.json({ ok: true, anchor })
  })

  // ---- Comment inbox (assigned via @agent tag or the human "Assign to agent" toggle) ----

  /**
   * Resolve the current block text for a comment so the agent gets live
   * context, not just the stored quote. Hydrate the in-memory doc from the
   * snapshot if no browser is connected, then read the enclosing block by
   * anchor. Falls back to the stored quote when the anchor no longer resolves.
   */
  function blockContext(docId: string, blockAnchor: string, quote: string): { block_text: string; block_resolved: boolean } {
    docManager.getOrCreate(docId).getXmlFragment('default')
    const live = docManager.getBlockTextByAnchor(docId, blockAnchor)
    if (live != null) return { block_text: live, block_resolved: true }
    return { block_text: quote, block_resolved: false }
  }

  async function hydrate(docId: string) {
    if (!docManager.docs.has(docId)) {
      const [doc] = await sql<{ yjs_state: Buffer | null }[]>`SELECT yjs_state FROM documents WHERE id = ${docId}`
      if (doc?.yjs_state) {
        const ydoc = docManager.getOrCreate(docId)
        ydoc.getXmlFragment('default')
        Y.applyUpdate(ydoc, new Uint8Array(doc.yjs_state))
      }
    }
  }

  /**
   * Agent inbox across ALL docs this key can access. Defaults to assigned +
   * open. Each item carries its block_anchor and the current block text.
   *
   * Query: ?assigned=true (default true) &status=open|resolved|all (default open)
   */
  agent.get('/comments', async (c) => {
    const { userId } = c.get('user')
    const statusQ = c.req.query('status') ?? 'open'
    if (!['open', 'resolved', 'all'].includes(statusQ)) {
      return c.json({ error: 'status must be open, resolved, or all.' }, 400)
    }
    // Only docs owned by / shared with this key's user.
    const docs = await sql<{ id: string }[]>`
      SELECT d.id FROM documents d
      LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${userId}
      WHERE d.owner_id = ${userId} OR dc.user_id IS NOT NULL
    `
    const out: unknown[] = []
    for (const d of docs) {
      const inbox = await listAgentInbox(d.id, statusQ as 'open' | 'resolved' | 'all')
      if (inbox.length === 0) continue
      await hydrate(d.id)
      for (const cm of inbox) {
        out.push({ ...cm, ...blockContext(d.id, cm.block_anchor, cm.quote) })
      }
    }
    return c.json(out)
  })

  /** Doc-scoped inbox — same shape, single doc. */
  agent.get('/documents/:id/comments', async (c) => {
    const docId = c.req.param('id')
    if (!isUuid(docId)) return c.json({ error: 'Invalid document id.' }, 400)
    const statusQ = c.req.query('status') ?? 'open'
    if (!['open', 'resolved', 'all'].includes(statusQ)) {
      return c.json({ error: 'status must be open, resolved, or all.' }, 400)
    }
    const inbox = await listAgentInbox(docId, statusQ as 'open' | 'resolved' | 'all')
    await hydrate(docId)
    return c.json(inbox.map((cm) => ({ ...cm, ...blockContext(docId, cm.block_anchor, cm.quote) })))
  })

  /** Full context for one comment: thread + current block text. */
  agent.get('/documents/:id/comments/:cid/context', async (c) => {
    const docId = c.req.param('id')
    const cid = c.req.param('cid')
    if (!isUuid(docId) || !isUuid(cid)) return c.json({ error: 'Invalid id.' }, 400)
    const cm = await getComment(docId, cid)
    if (!cm) return c.json({ error: 'Not found' }, 404)
    await hydrate(docId)
    return c.json({ ...cm, ...blockContext(docId, cm.block_anchor, cm.quote) })
  })

  /** Agent replies to a comment thread. */
  agent.post('/documents/:id/comments/:cid/reply', async (c) => {
    const { name } = c.get('user') as { name?: string }
    const docId = c.req.param('id')
    const cid = c.req.param('cid')
    if (!isUuid(docId) || !isUuid(cid)) return c.json({ error: 'Invalid id.' }, 400)
    const parent = await getComment(docId, cid)
    if (!parent || parent.parent_id !== null) return c.json({ error: 'Thread not found' }, 404)

    const raw = await safeJson(c.req)
    const bodyCheck = validateBody(raw.body)
    if (!bodyCheck.ok) return c.json({ error: bodyCheck.error }, bodyCheck.status)
    const tags = parseTags(bodyCheck.value)

    const row = await insertComment({
      docId,
      blockAnchor: parent.block_anchor,
      quote: parent.quote,
      body: bodyCheck.value,
      authorId: name || 'agent',
      authorType: 'agent',
      parentId: cid,
      assignedToAgent: false,
      tags,
    })
    return c.json({ ...row, tags }, 201)
  })

  /** Agent resolves a thread (after acting on it). */
  agent.post('/documents/:id/comments/:cid/resolve', async (c) => {
    const docId = c.req.param('id')
    const cid = c.req.param('cid')
    if (!isUuid(docId) || !isUuid(cid)) return c.json({ error: 'Invalid id.' }, 400)
    const row = await setStatus(docId, cid, 'resolved')
    if (!row) return c.json({ error: 'Thread not found' }, 404)
    return c.json(row)
  })

  return agent
}
