import { Hono } from 'hono'
import { deleteCookie, getCookie } from 'hono/cookie'
import { verifyJwt } from '../auth/jwt.js'
import { sql } from '../db/client.js'
import { github } from '../auth/github.js'
import { google } from '../auth/google.js'
import { magicLink } from '../auth/magic-link.js'
import { requireAuth } from '../auth/middleware.js'

export const authRoutes = new Hono()

authRoutes.route('/github', github)
authRoutes.route('/google', google)
authRoutes.route('/magic', magicLink)

authRoutes.get('/me', requireAuth, (c) => {
  return c.json(c.get('user'))
})

authRoutes.post('/logout', async (c) => {
  // Signing out also disconnects every agent the user allowed onto their canvas.
  const token = getCookie(c, 'session')
  if (token) {
    try {
      const { userId } = verifyJwt(token)
      await sql`DELETE FROM oauth_tokens WHERE user_id = ${userId}`
    } catch {
      // Expired or invalid session: nothing to revoke.
    }
  }
  deleteCookie(c, 'session')
  return c.json({ ok: true })
})
