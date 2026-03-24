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
