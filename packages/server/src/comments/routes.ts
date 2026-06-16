/**
 * Human comment API. Mounted under /api/documents (alongside documents.ts) so
 * the same optionalAuth + anon_session model applies: signed-in users and
 * anonymous-session visitors can both comment, exactly like they can both edit.
 *
 * Routes (all under /:id/comments):
 *   POST   /:id/comments               create a thread on a block
 *   POST   /:id/comments/:cid/reply    reply to a thread
 *   GET    /:id/comments?status=       list threads (+ replies + tags)
 *   POST   /:id/comments/:cid/resolve  resolve a thread
 *   POST   /:id/comments/:cid/reopen   reopen a thread
 *   POST   /:id/comments/:cid/assign-agent  toggle agent assignment
 */

import { Hono } from 'hono'
import { optionalAuth } from '../auth/middleware.js'
import { sql } from '../db/client.js'
import { rateLimit } from '../middleware/rate-limit.js'
import {
  isUuid,
  isStatus,
  isValidBlockAnchor,
  validateBody,
  safeJson,
  parseTags,
  tagsAssignAgent,
  LIMITS,
  type TagTarget,
} from './logic.js'
import {
  insertComment,
  listThreads,
  getComment,
  setStatus,
  setAssigned,
  type CommentWithTags,
} from './store.js'

/** Resolve the commenting identity from the auth context. */
function authorFromContext(c: import('hono').Context): { authorId: string | null } {
  const user = c.get('user')
  if (user) return { authorId: user.userId }
  const anon = c.get('anonymousId')
  return { authorId: anon ?? null }
}

/**
 * Can this caller see/comment on this doc? Anonymous + public docs are open to
 * anyone (matching documents.ts GET /:id). Private docs require the caller to
 * be the owner or a collaborator. Returns the doc row or null.
 */
async function accessibleDoc(c: import('hono').Context, docId: string): Promise<{ id: string } | null> {
  const [doc] = await sql<{ id: string; is_anonymous: boolean; is_public: boolean; owner_id: string | null }[]>`
    SELECT id, is_anonymous, is_public, owner_id FROM documents WHERE id = ${docId}
  `
  if (!doc) return null
  if (doc.is_anonymous || doc.is_public) return { id: doc.id }
  const user = c.get('user')
  if (!user) return null
  const [ok] = await sql`
    SELECT d.id FROM documents d
    LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${user.userId}
    WHERE d.id = ${docId} AND (d.owner_id = ${user.userId} OR dc.user_id IS NOT NULL)
  `
  return ok ? { id: docId } : null
}

export function createCommentRoutes() {
  const r = new Hono()

  // Create a thread anchored to a block. Public surface → rate limited.
  r.post('/:id/comments', rateLimit({ name: 'comment-create', limit: 30, windowSec: 60 }), optionalAuth, async (c) => {
    const docId = c.req.param('id')
    if (!isUuid(docId)) return c.json({ error: 'Invalid document id.' }, 400)
    const doc = await accessibleDoc(c, docId)
    if (!doc) return c.json({ error: 'Not found' }, 404)

    const raw = await safeJson(c.req)

    if (!isValidBlockAnchor(raw.block_anchor)) {
      return c.json({ error: 'A non-empty `block_anchor` (block text snippet) is required.' }, 400)
    }
    const bodyCheck = validateBody(raw.body)
    if (!bodyCheck.ok) return c.json({ error: bodyCheck.error }, bodyCheck.status)

    const quote = typeof raw.quote === 'string' ? raw.quote.slice(0, LIMITS.COMMENT_QUOTE) : ''
    const tags = parseTags(bodyCheck.value, normalizeExtraTags(raw.tags))
    const assigned = tagsAssignAgent(tags)
    const { authorId } = authorFromContext(c)

    const row = await insertComment({
      docId,
      blockAnchor: raw.block_anchor,
      quote,
      body: bodyCheck.value,
      authorId,
      authorType: 'human',
      parentId: null,
      assignedToAgent: assigned,
      tags,
    })
    return c.json({ ...row, tags }, 201)
  })

  // Reply to an existing thread.
  r.post('/:id/comments/:cid/reply', rateLimit({ name: 'comment-reply', limit: 60, windowSec: 60 }), optionalAuth, async (c) => {
    const docId = c.req.param('id')
    const cid = c.req.param('cid')
    if (!isUuid(docId) || !isUuid(cid)) return c.json({ error: 'Invalid id.' }, 400)
    const doc = await accessibleDoc(c, docId)
    if (!doc) return c.json({ error: 'Not found' }, 404)

    const parent = await getComment(docId, cid)
    if (!parent || parent.parent_id !== null) return c.json({ error: 'Thread not found' }, 404)

    const raw = await safeJson(c.req)
    const bodyCheck = validateBody(raw.body)
    if (!bodyCheck.ok) return c.json({ error: bodyCheck.error }, bodyCheck.status)

    const tags = parseTags(bodyCheck.value, normalizeExtraTags(raw.tags))
    const { authorId } = authorFromContext(c)

    const row = await insertComment({
      docId,
      blockAnchor: parent.block_anchor,
      quote: parent.quote,
      body: bodyCheck.value,
      authorId,
      authorType: 'human',
      parentId: cid,
      assignedToAgent: false,
      tags,
    })

    // Tagging @agent in a reply also routes the parent thread to the inbox.
    if (tagsAssignAgent(tags) && !parent.assigned_to_agent) {
      await setAssigned(docId, cid, true)
    }
    return c.json({ ...row, tags }, 201)
  })

  // List threads, optionally filtered by status.
  r.get('/:id/comments', optionalAuth, async (c) => {
    const docId = c.req.param('id')
    if (!isUuid(docId)) return c.json({ error: 'Invalid document id.' }, 400)
    const doc = await accessibleDoc(c, docId)
    if (!doc) return c.json({ error: 'Not found' }, 404)

    const statusQ = c.req.query('status')
    if (statusQ !== undefined && !isStatus(statusQ)) {
      return c.json({ error: 'status must be "open" or "resolved".' }, 400)
    }
    const threads: CommentWithTags[] = await listThreads(docId, statusQ as 'open' | 'resolved' | undefined)
    return c.json(threads)
  })

  // Resolve / reopen.
  r.post('/:id/comments/:cid/resolve', optionalAuth, (c) => updateStatus(c, 'resolved'))
  r.post('/:id/comments/:cid/reopen', optionalAuth, (c) => updateStatus(c, 'open'))

  async function updateStatus(c: import('hono').Context, status: 'open' | 'resolved') {
    const docId = c.req.param('id')
    const cid = c.req.param('cid')
    if (!isUuid(docId) || !isUuid(cid)) return c.json({ error: 'Invalid id.' }, 400)
    const doc = await accessibleDoc(c, docId)
    if (!doc) return c.json({ error: 'Not found' }, 404)
    const row = await setStatus(docId, cid, status)
    if (!row) return c.json({ error: 'Thread not found' }, 404)
    return c.json(row)
  }

  // Toggle agent assignment. Body: { assigned: boolean }.
  r.post('/:id/comments/:cid/assign-agent', optionalAuth, async (c) => {
    const docId = c.req.param('id')
    const cid = c.req.param('cid')
    if (!isUuid(docId) || !isUuid(cid)) return c.json({ error: 'Invalid id.' }, 400)
    const doc = await accessibleDoc(c, docId)
    if (!doc) return c.json({ error: 'Not found' }, 404)
    const raw = await safeJson(c.req)
    const assigned = raw.assigned !== false // default true; only explicit false unassigns
    const row = await setAssigned(docId, cid, assigned)
    if (!row) return c.json({ error: 'Thread not found' }, 404)
    return c.json(row)
  })

  return r
}

/** Sanitize client-supplied structured tags (from the autocomplete UI). */
function normalizeExtraTags(raw: unknown): TagTarget[] {
  if (!Array.isArray(raw)) return []
  const out: TagTarget[] = []
  for (const t of raw) {
    if (t && typeof t === 'object') {
      const tt = (t as Record<string, unknown>).target_type
      const target = (t as Record<string, unknown>).target
      if ((tt === 'agent' || tt === 'human') && typeof target === 'string') {
        out.push({ target_type: tt, target })
      }
    }
  }
  return out
}
