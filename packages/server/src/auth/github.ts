import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { config } from '../config.js'
import { sql } from '../db/client.js'
import { signJwt } from './jwt.js'

export const github = new Hono()

github.get('/login', (c) => {
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID!,
    redirect_uri: `${config.BASE_URL}/auth/github/callback`,
    scope: 'user:email',
  })
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

github.get('/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.json({ error: 'Missing code' }, 400)

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const { access_token } = await tokenRes.json() as { access_token: string }

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const ghUser = await userRes.json() as { email: string; name: string; avatar_url: string }

  // Get primary email if not public
  let email = ghUser.email
  if (!email) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const emails = await emailRes.json() as { email: string; primary: boolean }[]
    email = emails.find(e => e.primary)?.email ?? emails[0]?.email
  }

  const [user] = await sql`
    INSERT INTO users (email, name, avatar_url, auth_provider)
    VALUES (${email}, ${ghUser.name}, ${ghUser.avatar_url}, 'github')
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
    RETURNING *
  `

  const token = signJwt({ userId: user.id, email: user.email })
  setCookie(c, 'session', token, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 })
  return c.redirect('/')
})
