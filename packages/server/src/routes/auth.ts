import { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
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

authRoutes.post('/logout', (c) => {
  deleteCookie(c, 'session')
  return c.json({ ok: true })
})
