/**
 * Per-IP / per-anon-session rate limiting for the public, no-auth endpoints
 * (anonymous doc create, markdown import, comment create). Backed by the
 * existing Redis via a fixed-window counter — cheap, atomic (INCR + EXPIRE),
 * good enough to blunt scripted abuse from the open internet without a
 * dependency.
 *
 * Authenticated callers (valid session / bearer / API key) are exempt: the
 * limiter only guards the anonymous surface. We key on the anon_session cookie
 * when present (stable across a browser), else the best-effort client IP.
 */

import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { redis } from '../redis.js'

export interface RateLimitOptions {
  /** Stable name for the limited action — namespaces the Redis key. */
  name: string
  /** Max requests allowed per window. */
  limit: number
  /** Window length in seconds. */
  windowSec: number
}

/** Best-effort client identifier: anon_session cookie, else forwarded IP. */
export function clientKey(c: Context): string {
  const anon = getCookie(c, 'anon_session')
  if (anon) return `anon:${anon}`
  const fwd = c.req.header('x-forwarded-for')
  const ip = (fwd ? fwd.split(',')[0] : '').trim() || c.req.header('x-real-ip') || 'unknown'
  return `ip:${ip}`
}

/**
 * Core fixed-window check. Exposed (with an injectable redis-like client) so it
 * can be unit-tested without a live server. Returns whether the request is
 * allowed plus the current count.
 */
export async function checkRateLimit(
  client: Pick<typeof redis, 'incr' | 'expire'>,
  redisKey: string,
  limit: number,
  windowSec: number,
): Promise<{ allowed: boolean; count: number }> {
  const count = await client.incr(redisKey)
  if (count === 1) {
    // First hit in this window — set the TTL so the counter resets.
    await client.expire(redisKey, windowSec)
  }
  return { allowed: count <= limit, count }
}

/**
 * Hono middleware. Skips authenticated users (Authorization/session present),
 * counts everyone else. On limit breach returns 429 with Retry-After. Fails
 * open if Redis is unreachable — availability over strictness for a public
 * collaboration tool.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    // Exempt authenticated requests — they have their own accountability.
    const hasAuth =
      !!getCookie(c, 'session') || !!c.req.header('Authorization') || !!c.req.header('X-API-Key')
    if (hasAuth) return next()

    const key = `ratelimit:${opts.name}:${clientKey(c)}`
    try {
      const { allowed } = await checkRateLimit(redis, key, opts.limit, opts.windowSec)
      if (!allowed) {
        c.header('Retry-After', String(opts.windowSec))
        return c.json({ error: 'Rate limit exceeded. Please slow down.' }, 429)
      }
    } catch {
      // Redis down: don't block writes on the limiter.
    }
    return next()
  }
}
