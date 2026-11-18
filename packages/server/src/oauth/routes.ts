import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { nanoid } from 'nanoid'
import { config } from '../config.js'
import { sql } from '../db/client.js'
import { verifyJwt } from '../auth/jwt.js'
import {
  ACCESS_TTL_S,
  CODE_TTL_S,
  REFRESH_TTL_S,
  SCOPE,
  agentName,
  consentToken,
  hashSecret,
  isAllowedRedirectUri,
  newSecret,
  redirectMatches,
  safeEqual,
  verifyPkce,
} from './logic.js'

// OAuth 2.1 authorization server for MCP clients, following the MCP authorization
// spec: protected-resource and authorization-server metadata, dynamic client
// registration, authorization code + PKCE (S256) and rotating refresh tokens.
// Users sign in with their existing paired.cc account.

const base = () => config.BASE_URL.replace(/\/$/, '')
export const mcpResource = () => `${base()}/mcp`

export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [base()],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Paired canvas',
    resource_documentation: `${base()}/agent-setup.md`,
  }
}

export function authorizationServerMetadata() {
  return {
    issuer: base(),
    authorization_endpoint: `${base()}/oauth/authorize`,
    token_endpoint: `${base()}/oauth/token`,
    registration_endpoint: `${base()}/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    service_documentation: `${base()}/agent-setup.md`,
  }
}

/** Resolves an access token to its user and the agent it was issued to. */
export async function authenticateAccessToken(token: string) {
  const [row] = await sql`
    SELECT t.user_id, u.email, c.name AS client_name
    FROM oauth_tokens t
    JOIN users u ON u.id = t.user_id
    JOIN oauth_clients c ON c.id = t.client_id
    WHERE t.token_hash = ${hashSecret(token)} AND t.kind = 'access' AND t.expires_at > now()
  `
  if (!row) return null
  return { userId: row.user_id as string, email: row.email as string, agent: agentName(row.client_name) }
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

function page(c: Context, title: string, body: string, status: 200 | 400 = 200) {
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
  c.header('X-Frame-Options', 'DENY')
  c.header('Cache-Control', 'no-store')
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · Paired</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#efede8;font:15px/1.55 Inter,-apple-system,BlinkMacSystemFont,sans-serif;color:#1f1d2c}
main{background:#fff;border-radius:14px;padding:32px;max-width:420px;margin:16px;box-shadow:0 10px 40px #0001}
h1{font-size:20px;margin:0 0 12px}p{color:#55524c;margin:0 0 14px}b{color:#1f1d2c}
.actions{display:flex;gap:10px;margin-top:22px}button{flex:1;font:inherit;border-radius:8px;padding:10px;cursor:pointer;border:1px solid #d9d9e2;background:#fff}
button.allow{background:#1f1d2c;color:#fff;border-color:#1f1d2c}button.allow:hover{background:#3a2fd0}
small{display:block;color:#8a877f;margin-top:16px}
</style></head><body><main>${body}</main></body></html>`,
    status,
  )
}

type AuthorizeParams = { clientId: string; clientName: string; redirectUri: string; challenge: string; state: string; scope: string }

async function readAuthorizeParams(get: (k: string) => string | undefined): Promise<AuthorizeParams | { error: string }> {
  const clientId = get('client_id') ?? ''
  const redirectUri = get('redirect_uri') ?? ''
  const [client] = clientId ? await sql`SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ${clientId}` : []
  if (!client) return { error: 'This agent is not registered with Paired. Ask it to connect again.' }
  if (!redirectUri || !redirectMatches(client.redirect_uris, redirectUri))
    return { error: 'The agent asked to return to an address it did not register.' }
  return {
    clientId,
    clientName: agentName(client.name),
    redirectUri,
    challenge: get('code_challenge') ?? '',
    state: get('state') ?? '',
    scope: SCOPE,
  }
}

function redirectWith(c: Context, uri: string, params: Record<string, string>) {
  const url = new URL(uri)
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  return c.redirect(url.toString(), 302)
}

async function currentUser(c: Context) {
  const token = getCookie(c, 'session')
  if (!token) return null
  try {
    const { userId } = verifyJwt(token)
    const [user] = await sql`SELECT id, email FROM users WHERE id = ${userId}`
    return user ? { userId: user.id as string, email: user.email as string } : null
  } catch {
    return null
  }
}

const canonical = (p: AuthorizeParams) => JSON.stringify([p.clientId, p.redirectUri, p.challenge, p.state, p.scope])

async function issueTokens(clientId: string, userId: string) {
  const access = newSecret(), refresh = newSecret()
  await sql`
    INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scope, expires_at) VALUES
      (${hashSecret(access)}, 'access', ${clientId}, ${userId}, ${SCOPE}, now() + make_interval(secs => ${ACCESS_TTL_S})),
      (${hashSecret(refresh)}, 'refresh', ${clientId}, ${userId}, ${SCOPE}, now() + make_interval(secs => ${REFRESH_TTL_S}))
  `
  await sql`DELETE FROM oauth_tokens WHERE expires_at < now() - interval '1 day'`
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE }
}

export const oauthRoutes = new Hono()

const cors = (c: Context) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}
for (const path of [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/oauth/register',
  '/oauth/token',
])
  oauthRoutes.options(path, (c) => {
    cors(c)
    return c.body(null, 204)
  })

oauthRoutes.get('/.well-known/oauth-protected-resource', (c) => (cors(c), c.json(protectedResourceMetadata())))
oauthRoutes.get('/.well-known/oauth-protected-resource/mcp', (c) => (cors(c), c.json(protectedResourceMetadata())))
oauthRoutes.get('/.well-known/oauth-authorization-server', (c) => (cors(c), c.json(authorizationServerMetadata())))

// Dynamic client registration (RFC 7591). Public clients only.
oauthRoutes.post('/oauth/register', async (c) => {
  cors(c)
  let body: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_client_metadata', error_description: 'Send JSON client metadata' }, 400)
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : []
  if (!uris.length || uris.length > 10 || !uris.every(isAllowedRedirectUri))
    return c.json({ error: 'invalid_redirect_uri', error_description: 'Use https, a loopback http address or an app scheme' }, 400)
  const name = agentName(typeof body.client_name === 'string' ? body.client_name : undefined)
  const id = `pc_${nanoid(24)}`
  await sql`INSERT INTO oauth_clients (id, name, redirect_uris) VALUES (${id}, ${name}, ${uris})`
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: SCOPE,
    },
    201,
  )
})

oauthRoutes.get('/oauth/authorize', async (c) => {
  const params = await readAuthorizeParams((k) => c.req.query(k))
  if ('error' in params) return page(c, 'Cannot connect', `<h1>Cannot connect this agent</h1><p>${escape(params.error)}</p>`, 400)
  if (c.req.query('response_type') !== 'code')
    return redirectWith(c, params.redirectUri, { error: 'unsupported_response_type', state: params.state })
  if (c.req.query('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.challenge))
    return redirectWith(c, params.redirectUri, { error: 'invalid_request', error_description: 'PKCE with S256 is required', state: params.state })

  const user = await currentUser(c)
  if (!user) {
    const here = new URL(c.req.url)
    return c.redirect(`/docs/login?returnTo=${encodeURIComponent(here.pathname + here.search)}`, 302)
  }
  const token = consentToken(config.JWT_SECRET, user.userId, canonical(params))
  const target = (() => {
    const u = new URL(params.redirectUri)
    return u.protocol === 'http:' ? 'this computer' : u.host || u.protocol.replace(':', '')
  })()
  const hidden = Object.entries({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_challenge: params.challenge,
    state: params.state,
    consent: token,
  })
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
    .join('')
  return page(
    c,
    'Connect an agent',
    `<h1>Let <b>${escape(params.clientName)}</b> work on your canvas?</h1>
<p>It will be able to read and edit the Paired canvases you have open while signed in as <b>${escape(user.email)}</b>. Its notes are marked as agent work.</p>
<p>After you allow it, you'll go back to ${escape(target)}.</p>
<form method="post" action="/oauth/authorize">${hidden}<div class="actions">
<button type="submit" name="decision" value="deny">Cancel</button>
<button type="submit" name="decision" value="allow" class="allow">Allow</button></div></form>
<small>You can disconnect an agent at any time by signing out of Paired.</small>`,
  )
})

oauthRoutes.post('/oauth/authorize', async (c) => {
  const form = await c.req.parseBody()
  const get = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : undefined)
  const params = await readAuthorizeParams(get)
  if ('error' in params) return page(c, 'Cannot connect', `<h1>Cannot connect this agent</h1><p>${escape(params.error)}</p>`, 400)
  const user = await currentUser(c)
  const expected = user ? consentToken(config.JWT_SECRET, user.userId, canonical(params)) : ''
  if (!user || !safeEqual(get('consent') ?? '', expected))
    return page(c, 'Cannot connect', '<h1>This request expired</h1><p>Ask your agent to connect again.</p>', 400)
  if (get('decision') !== 'allow') return redirectWith(c, params.redirectUri, { error: 'access_denied', state: params.state })
  const code = newSecret()
  await sql`
    INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires_at)
    VALUES (${hashSecret(code)}, ${params.clientId}, ${user.userId}, ${params.redirectUri}, ${params.challenge}, ${SCOPE},
            now() + make_interval(secs => ${CODE_TTL_S}))
  `
  return redirectWith(c, params.redirectUri, { code, state: params.state, iss: base() })
})

oauthRoutes.post('/oauth/token', async (c) => {
  cors(c)
  c.header('Cache-Control', 'no-store')
  const type = c.req.header('content-type') ?? ''
  const body: Record<string, unknown> = type.includes('application/json') ? await c.req.json().catch(() => ({})) : await c.req.parseBody()
  const get = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '')
  const fail = (error: string, description: string) => c.json({ error, error_description: description }, 400)

  if (get('grant_type') === 'authorization_code') {
    const [row] = await sql`DELETE FROM oauth_codes WHERE code_hash = ${hashSecret(get('code'))} RETURNING *`
    if (!row || new Date(row.expires_at) < new Date()) return fail('invalid_grant', 'Code is invalid or expired')
    if (row.client_id !== get('client_id')) return fail('invalid_grant', 'Code was issued to another client')
    if (row.redirect_uri !== get('redirect_uri')) return fail('invalid_grant', 'redirect_uri does not match')
    if (!verifyPkce(get('code_verifier'), row.code_challenge)) return fail('invalid_grant', 'PKCE verification failed')
    return c.json(await issueTokens(row.client_id, row.user_id))
  }
  if (get('grant_type') === 'refresh_token') {
    const [row] = await sql`
      DELETE FROM oauth_tokens WHERE token_hash = ${hashSecret(get('refresh_token'))} AND kind = 'refresh' RETURNING *
    `
    if (!row || new Date(row.expires_at) < new Date()) return fail('invalid_grant', 'Refresh token is invalid or expired')
    if (get('client_id') && row.client_id !== get('client_id')) return fail('invalid_grant', 'Token was issued to another client')
    return c.json(await issueTokens(row.client_id, row.user_id))
  }
  return fail('unsupported_grant_type', 'Use authorization_code or refresh_token')
})
