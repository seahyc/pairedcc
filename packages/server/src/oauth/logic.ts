import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SCOPE = 'canvas'
export const ACCESS_TTL_S = 60 * 60
export const REFRESH_TTL_S = 90 * 24 * 60 * 60
export const CODE_TTL_S = 5 * 60

export const newSecret = () => randomBytes(32).toString('base64url')
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex')

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export function verifyPkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  const computed = createHash('sha256').update(verifier).digest('base64url')
  return safeEqual(computed, challenge)
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const blockedSchemes = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'])

/**
 * Redirect URIs a public client may register: https anywhere, http only on
 * loopback (native apps such as Claude Code and Codex), or a private-use app
 * scheme (cursor://...). No fragments.
 */
export function isAllowedRedirectUri(raw: string) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.hash || raw.length > 2000) return false
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') return loopbackHosts.has(url.hostname)
  if (blockedSchemes.has(url.protocol)) return false
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
}

/** Exact match, except that loopback redirects may use any port (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], candidate: string) {
  if (registered.includes(candidate)) return true
  let c: URL
  try {
    c = new URL(candidate)
  } catch {
    return false
  }
  if (c.protocol !== 'http:' || !loopbackHosts.has(c.hostname)) return false
  return registered.some((r) => {
    try {
      const u = new URL(r)
      return u.protocol === 'http:' && u.hostname === c.hostname && u.pathname === c.pathname && u.search === c.search
    } catch {
      return false
    }
  })
}

/**
 * Name an agent's work is credited to on the board. The client chooses its own
 * name at registration, so it must never pass itself off as the human.
 */
export function agentName(clientName: string | undefined) {
  const name = (clientName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60)
  if (!name || /^human$/i.test(name)) return 'Agent'
  return name
}

/** Signs the consent form so it can only be submitted by the user who saw it. */
export function consentToken(secret: string, userId: string, params: string) {
  return createHmac('sha256', secret).update(`consent|${userId}|${params}`).digest('base64url')
}
