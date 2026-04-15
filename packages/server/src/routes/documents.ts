import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import * as Y from 'yjs'
import { requireAuth, optionalAuth } from '../auth/middleware.js'
import { sql } from '../db/client.js'
import type { DocManager } from '../yjs/doc-manager.js'

export const documentRoutes = new Hono()

// List user's documents (owned + collaborating) — requires auth.
// Excludes archived docs unless ?include_archived=true.
documentRoutes.get('/', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const includeArchived = c.req.query('include_archived') === 'true'
  const docs = includeArchived
    ? await sql`
        SELECT d.id, d.title, d.created_at, d.updated_at, d.owner_id, d.is_anonymous, d.is_public, d.archived
        FROM documents d
        LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${userId}
        WHERE d.owner_id = ${userId} OR dc.user_id IS NOT NULL
        ORDER BY d.updated_at DESC
      `
    : await sql`
        SELECT d.id, d.title, d.created_at, d.updated_at, d.owner_id, d.is_anonymous, d.is_public, d.archived
        FROM documents d
        LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${userId}
        WHERE (d.owner_id = ${userId} OR dc.user_id IS NOT NULL) AND d.archived = false
        ORDER BY d.updated_at DESC
      `
  return c.json(docs)
})

// Create document — supports anonymous creation (no auth required)
documentRoutes.post('/', optionalAuth, async (c) => {
  const user = c.get('user')
  const { title } = await c.req.json<{ title?: string }>().catch(() => ({ title: undefined }))

  if (user) {
    // Authenticated user creates a normal document
    const [doc] = await sql`
      INSERT INTO documents (title, owner_id)
      VALUES (${title || 'Untitled'}, ${user.userId})
      RETURNING *
    `
    return c.json(doc, 201)
  }

  // Anonymous document with 24h expiry
  const anonId = c.get('anonymousId')!
  setCookie(c, 'anon_session', anonId, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 24 * 60 * 60,
  })

  const [doc] = await sql`
    INSERT INTO documents (title, is_anonymous, expires_at)
    VALUES (${title || 'Untitled'}, true, now() + interval '24 hours')
    RETURNING *
  `
  return c.json({ ...doc, anon_session: anonId }, 201)
})

// Claim an anonymous document — authenticated user takes ownership
documentRoutes.post('/:id/claim', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')

  const [doc] = await sql`
    UPDATE documents
    SET owner_id = ${userId}, is_anonymous = false, expires_at = null, updated_at = now()
    WHERE id = ${docId} AND is_anonymous = true
    RETURNING *
  `
  if (!doc) return c.json({ error: 'Not found or not anonymous' }, 404)
  return c.json(doc)
})

// Get document — anonymous + public docs are accessible to anyone, otherwise auth required
documentRoutes.get('/:id', optionalAuth, async (c) => {
  const user = c.get('user')
  const docId = c.req.param('id')

  const [doc] = await sql`SELECT * FROM documents WHERE id = ${docId}`
  if (!doc) return c.json({ error: 'Not found' }, 404)

  if (doc.is_anonymous || doc.is_public) return c.json(doc)

  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const [accessible] = await sql`
    SELECT d.* FROM documents d
    LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${user.userId}
    WHERE d.id = ${docId} AND (d.owner_id = ${user.userId} OR dc.user_id IS NOT NULL)
  `
  if (!accessible) return c.json({ error: 'Not found' }, 404)
  return c.json(accessible)
})

// Toggle public visibility — only owner can change this
documentRoutes.patch('/:id/visibility', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  const { is_public } = await c.req.json<{ is_public: boolean }>()
  const [doc] = await sql`
    UPDATE documents SET is_public = ${!!is_public}, updated_at = now()
    WHERE id = ${docId} AND owner_id = ${userId}
    RETURNING *
  `
  if (!doc) return c.json({ error: 'Not found or not owner' }, 404)
  return c.json(doc)
})

// Update document — title and/or archived flag. Owner-only.
documentRoutes.patch('/:id', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  const body = await c.req.json<{ title?: string; archived?: boolean }>()

  // Build a single update with whichever fields the caller supplied.
  // postgres.js doesn't compose dynamic SETs cleanly, so we branch.
  let doc
  if (body.title !== undefined && body.archived !== undefined) {
    [doc] = await sql`
      UPDATE documents SET title = ${body.title}, archived = ${body.archived}, updated_at = now()
      WHERE id = ${docId} AND owner_id = ${userId}
      RETURNING *
    `
  } else if (body.title !== undefined) {
    [doc] = await sql`
      UPDATE documents SET title = ${body.title}, updated_at = now()
      WHERE id = ${docId} AND owner_id = ${userId}
      RETURNING *
    `
  } else if (body.archived !== undefined) {
    [doc] = await sql`
      UPDATE documents SET archived = ${body.archived}, updated_at = now()
      WHERE id = ${docId} AND owner_id = ${userId}
      RETURNING *
    `
  } else {
    return c.json({ error: 'Nothing to update' }, 400)
  }

  if (!doc) return c.json({ error: 'Not found or not owner' }, 404)
  return c.json(doc)
})

// Delete document
documentRoutes.delete('/:id', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  await sql`DELETE FROM documents WHERE id = ${docId} AND owner_id = ${userId}`
  return c.json({ ok: true })
})

/**
 * Routes that need access to the live Yjs DocManager (e.g. for serializing
 * doc content to markdown). Mounted separately so the simple CRUD routes
 * above can stay dependency-free.
 */
export function createPublicDocRoutes(docManager: DocManager) {
  const r = new Hono()

  // Agent / WebFetch-friendly: returns the doc as plain markdown.
  // No auth — only public + anonymous docs are exposed. Private docs 404
  // (not 401) so we don't leak existence to unauthenticated probes.
  r.get('/:id/raw', async (c) => {
    const docId = c.req.param('id')
    const [doc] = await sql`SELECT id, title, is_public, is_anonymous, yjs_state FROM documents WHERE id = ${docId}`
    if (!doc || (!doc.is_public && !doc.is_anonymous)) {
      return c.text('Not found', 404)
    }

    // Prefer the in-memory Yjs doc (live edits); fall back to the persisted
    // snapshot. Hydrate the manager with the snapshot if needed so the same
    // serializer path is used in both cases.
    if (!docManager.docs.has(docId) && doc.yjs_state) {
      const ydoc = docManager.getOrCreate(docId)
      ydoc.getXmlFragment('default')
      Y.applyUpdate(ydoc, new Uint8Array(doc.yjs_state))
    }

    const md = docManager.getMarkdown(docId)
    const body = doc.title ? `# ${doc.title}\n\n${md}` : md
    c.header('Content-Type', 'text/markdown; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(body)
  })

  return r
}
