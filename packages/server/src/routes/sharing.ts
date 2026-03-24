import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware.js'
import { sql } from '../db/client.js'

export const sharingRoutes = new Hono()

sharingRoutes.use('*', requireAuth)

// Add collaborator to a document
sharingRoutes.post('/:docId/share', async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('docId')
  const { email, role } = await c.req.json<{ email: string; role?: string }>()

  // Verify the user owns this doc
  const [doc] = await sql`SELECT id FROM documents WHERE id = ${docId} AND owner_id = ${userId}`
  if (!doc) return c.json({ error: 'Not found or not owner' }, 404)

  // Find or create user by email
  const [targetUser] = await sql`
    INSERT INTO users (email, auth_provider)
    VALUES (${email}, 'magic')
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id
  `

  await sql`
    INSERT INTO document_collaborators (document_id, user_id, role)
    VALUES (${docId}, ${targetUser.id}, ${role || 'editor'})
    ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `

  return c.json({ ok: true })
})

// List collaborators
sharingRoutes.get('/:docId/share', async (c) => {
  const docId = c.req.param('docId')
  const collaborators = await sql`
    SELECT u.id, u.email, u.name, u.avatar_url, dc.role, dc.added_at
    FROM document_collaborators dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.document_id = ${docId}
    ORDER BY dc.added_at
  `
  return c.json(collaborators)
})

// Remove collaborator
sharingRoutes.delete('/:docId/share/:userId', async (c) => {
  const ownerId = c.get('user').userId
  const docId = c.req.param('docId')
  const targetUserId = c.req.param('userId')

  const [doc] = await sql`SELECT id FROM documents WHERE id = ${docId} AND owner_id = ${ownerId}`
  if (!doc) return c.json({ error: 'Not found or not owner' }, 404)

  await sql`DELETE FROM document_collaborators WHERE document_id = ${docId} AND user_id = ${targetUserId}`
  return c.json({ ok: true })
})
