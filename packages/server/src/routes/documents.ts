import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { requireAuth, optionalAuth } from '../auth/middleware.js'
import { sql } from '../db/client.js'

export const documentRoutes = new Hono()

// List user's documents (owned + collaborating) — requires auth
documentRoutes.get('/', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docs = await sql`
    SELECT d.id, d.title, d.created_at, d.updated_at, d.owner_id, d.is_anonymous
    FROM documents d
    LEFT JOIN document_collaborators dc ON dc.document_id = d.id AND dc.user_id = ${userId}
    WHERE d.owner_id = ${userId} OR dc.user_id IS NOT NULL
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

// Get document — requires auth
documentRoutes.get('/:id', requireAuth, async (c) => {
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
documentRoutes.patch('/:id', requireAuth, async (c) => {
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
documentRoutes.delete('/:id', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  await sql`DELETE FROM documents WHERE id = ${docId} AND owner_id = ${userId}`
  return c.json({ ok: true })
})
