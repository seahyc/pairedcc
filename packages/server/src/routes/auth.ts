import { Hono } from 'hono'
import { deleteCookie, getCookie } from 'hono/cookie'
import { verifyJwt } from '../auth/jwt.js'
import { config } from '../config.js'
import { sql } from '../db/client.js'
import { github } from '../auth/github.js'
import { google } from '../auth/google.js'
import { magicLink } from '../auth/magic-link.js'
import { requireAuth } from '../auth/middleware.js'

export const authRoutes = new Hono()

authRoutes.route('/github', github)
authRoutes.route('/google', google)
authRoutes.route('/magic', magicLink)

// Which sign-in methods this deployment can actually complete, so the login page offers only those.
// A magic link is only useful when the server can email it.
export function signInMethods(env: { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; SMTP_URL?: string }) {
  return {
    github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    magic: Boolean(env.SMTP_URL),
  }
}

authRoutes.get('/methods', (c) => c.json(signInMethods(config)))

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
