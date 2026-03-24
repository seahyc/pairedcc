import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { config } from '../config.js'
import { sql } from '../db/client.js'
import { signJwt } from './jwt.js'
import { nanoid } from 'nanoid'

// In-memory token store for MVP. Replace with Redis for production.
const pendingTokens = new Map<string, { email: string; expiresAt: number }>()

export const magicLink = new Hono()

magicLink.post('/send', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  if (!email) return c.json({ error: 'Email required' }, 400)

  const token = nanoid(32)
  pendingTokens.set(token, { email, expiresAt: Date.now() + 15 * 60 * 1000 })

  const link = `${config.BASE_URL}/auth/magic/verify?token=${token}`

  // TODO: Send email via SMTP. For now, log the link.
  console.log(`Magic link for ${email}: ${link}`)

  return c.json({ ok: true })
})

magicLink.get('/verify', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Missing token' }, 400)

  const pending = pendingTokens.get(token)
  if (!pending || pending.expiresAt < Date.now()) {
    return c.json({ error: 'Invalid or expired token' }, 400)
  }
  pendingTokens.delete(token)

  const [user] = await sql`
    INSERT INTO users (email, auth_provider)
    VALUES (${pending.email}, 'magic')
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING *
  `

  const jwt = signJwt({ userId: user.id, email: user.email })
  setCookie(c, 'session', jwt, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 })
  return c.redirect('/')
})
