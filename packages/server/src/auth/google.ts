import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { config } from '../config.js'
import { sql } from '../db/client.js'
import { signJwt } from './jwt.js'

export const google = new Hono()

google.get('/login', (c) => {
  const returnTo = c.req.query('returnTo') || '/'
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    redirect_uri: `${config.BASE_URL}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state: returnTo,
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

google.get('/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.json({ error: 'Missing code' }, 400)

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID!,
      client_secret: config.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${config.BASE_URL}/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const { access_token } = await tokenRes.json() as { access_token: string }

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const gUser = await userRes.json() as { email: string; name: string; picture: string }

  const [user] = await sql`
    INSERT INTO users (email, name, avatar_url, auth_provider)
    VALUES (${gUser.email}, ${gUser.name}, ${gUser.picture}, 'google')
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
    RETURNING *
  `

  const token = signJwt({ userId: user.id, email: user.email })
  setCookie(c, 'session', token, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 })
  const returnTo = c.req.query('state') || '/'
  return c.redirect(returnTo)
})
