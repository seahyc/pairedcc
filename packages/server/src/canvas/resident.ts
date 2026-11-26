import { Hono, type MiddlewareHandler } from 'hono'
import type { CanvasRelay } from './relay.js'

// The resident agent's side of the hosted relay. It long-polls for the next ask from an
// allowlisted account and answers through the canvas's own ask operations. The paths and
// bodies match the local development relay, so one agent script serves both.
//
// Off (404) unless CANVAS_RESIDENT_SECRET is set; every request must carry that secret.

const MAX_WAIT_MS = 30_000

export function createResidentRoutes(relay: CanvasRelay) {
  const app = new Hono()

  // Guard only the resident agent's own two paths. A wider pattern would also answer for
  // every other /api/canvas route registered after this one (the board API, for instance).
  const guard: MiddlewareHandler = async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (!relay.residentEnabled) return c.json({ error: 'Not found' }, 404)
    const header = c.req.header('Authorization') ?? ''
    if (!header.startsWith('Bearer ') || !relay.residentSecretMatches(header.slice(7).trim())) return c.json({ error: 'Unauthorized' }, 401)
    await next()
  }
  app.use('/api/canvas/asks/wait', guard)
  app.use('/api/canvas/command', guard)

  app.post('/api/canvas/asks/wait', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { agent?: unknown; waitMs?: unknown }
    const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, 100) : 'Agent'
    const waitMs = typeof body.waitMs === 'number' && Number.isFinite(body.waitMs) ? Math.min(MAX_WAIT_MS, Math.max(0, Math.floor(body.waitMs))) : 25_000
    const waiting = relay.waitForAsk(agent, waitMs)
    // If the agent hangs up, stop waiting so the next ask is not handed to nobody.
    c.req.raw.signal.addEventListener('abort', () => waiting.cancel(), { once: true })
    return c.json((await waiting.promise) ?? { ask: null })
  })

  app.post('/api/canvas/command', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      sessionId?: unknown
      actor?: unknown
      command?: { op?: unknown; input?: unknown }
    } | null
    const op = body?.command?.op
    if (!body || typeof body.sessionId !== 'string' || typeof op !== 'string')
      return c.json({ ok: false, error: 'sessionId and command.op are required' }, 400)
    const actor = typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim().slice(0, 100) : 'Agent'
    const input = typeof body.command?.input === 'object' && body.command.input !== null ? (body.command.input as Record<string, unknown>) : {}
    const result = await relay.sendFromResident(body.sessionId, { op, input }, actor)
    return c.json(result, result.ok ? 200 : 422)
  })

  return app
}
