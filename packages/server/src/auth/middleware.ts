import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyJwt, type JwtPayload } from './jwt.js'
import { sql } from '../db/client.js'
import { nanoid } from 'nanoid'

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload & { name?: string }
    anonymousId: string | null
  }
}

export const requireAuth = createMiddleware(async (c, next) => {
  const token = getCookie(c, 'session') || c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = verifyJwt(token)
    c.set('user', payload)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

export const optionalAuth = createMiddleware(async (c, next) => {
  const token = getCookie(c, 'session') || c.req.header('Authorization')?.replace('Bearer ', '')

  if (token) {
    try {
      const payload = verifyJwt(token)
      c.set('user', payload)
      c.set('anonymousId', null)
      return await next()
    } catch {
      // Invalid token, fall through to anonymous
    }
  }

  // Anonymous session: use or create a cookie-based anonymous ID
  let anonId = getCookie(c, 'anon_session')
  if (!anonId) {
    anonId = `anon_${nanoid(16)}`
  }
  c.set('anonymousId', anonId)
  await next()
})

export const requireApiKey = createMiddleware(async (c, next) => {
  const key = c.req.header('X-API-Key')
  if (!key) return c.json({ error: 'API key required' }, 401)

  const [row] = await sql`
    SELECT ak.user_id, u.email, u.name
    FROM api_keys ak JOIN users u ON ak.user_id = u.id
    WHERE ak.key_hash = crypt(${key}, ak.key_hash)
  `
  if (!row) return c.json({ error: 'Invalid API key' }, 401)

  await sql`UPDATE api_keys SET last_used = now() WHERE key_hash = crypt(${key}, key_hash)`
  c.set('user', { userId: row.user_id, email: row.email, name: row.name })
  await next()
})
