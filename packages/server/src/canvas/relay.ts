import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { verifyJwt } from '../auth/jwt.js'
import { AskDesk, type AnnouncedAsk } from '../../../canvas/server/asks.js'

// Carries agent commands from /mcp to the signed-in user's open canvas tabs.
// The board itself still lives in the browser; this relay only forwards
// commands and their results, and only between tabs and agents of one user.

export const RELAY_PATH = '/canvas-relay'
const TIMEOUT_MS = 20_000
const PING_MS = 25_000

type Session = { id: string; title: string; ws: WebSocket; userId: string; connectedAt: number; resident: boolean }
type Who = { userId: string; email?: string }

/**
 * The resident agent: one trusted process (it holds a shared secret) that answers
 * asks for the accounts on an allowlist. It spends its owner's model subscription,
 * so asks from any other account never reach it.
 */
export type ResidentOptions = {
  /** Shared secret the resident agent presents. Unset: the whole channel is off. */
  secret?: string
  /** Account ids or sign-in emails that get resident answers. */
  allow?: string[]
  /** Asks one account may make per window (default 30 per 10 minutes). */
  maxAsks?: number
  windowMs?: number
}
const RESIDENT_OPS = new Set(['ask_status', 'answer'])
const MAX_ASK_BYTES = 64 * 1024
type Pending = { ws: WebSocket; resolve: (r: RelayResult) => void; timer: ReturnType<typeof setTimeout> }
export type RelayResult = { ok: true; result: unknown } | { ok: false; error: string }
export type CanvasCommand = { op: string; input?: Record<string, unknown> }

function cookie(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export class CanvasRelay {
  private sessions = new Map<string, Session>()
  private pending = new Map<string, Pending>()
  private allow: Set<string>
  private asked = new Map<string, number[]>()
  private desk = new AskDesk((agents) => {
    for (const s of this.sessions.values()) if (s.resident) s.ws.send(JSON.stringify({ type: 'listeners', agents }))
  })

  constructor(
    private allowedOrigins: string[],
    private resident: ResidentOptions = {},
  ) {
    // A short secret is a misconfiguration; stay off rather than run with a guessable one.
    if (resident.secret !== undefined && resident.secret.length < 32) this.resident = { ...resident, secret: undefined }
    this.allow = new Set((resident.allow ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean))
  }

  /** Whether the resident agent may connect at all. */
  get residentEnabled() {
    return Boolean(this.resident.secret)
  }

  /** Constant-time check of the resident agent's secret. Always false while the channel is off. */
  residentSecretMatches(candidate: string) {
    const secret = this.resident.secret
    if (!secret || !candidate) return false
    const digest = (value: string) => createHash('sha256').update(value).digest()
    return timingSafeEqual(digest(candidate), digest(secret))
  }

  private allowed(who: Who) {
    if (!this.residentEnabled) return false
    return this.allow.has(who.userId.toLowerCase()) || Boolean(who.email && this.allow.has(who.email.toLowerCase()))
  }

  /** Fixed budget of asks per account, so a runaway tab cannot spend the owner's subscription. */
  private underLimit(userId: string) {
    const windowMs = this.resident.windowMs ?? 10 * 60_000, max = this.resident.maxAsks ?? 30
    const now = Date.now()
    const recent = (this.asked.get(userId) ?? []).filter((at) => now - at < windowMs)
    const ok = recent.length < max
    if (ok) recent.push(now)
    this.asked.set(userId, recent)
    return ok
  }

  /** The resident agent waits here for the next ask from an allowlisted account. */
  waitForAsk(agent: string, waitMs: number) {
    return this.desk.wait(agent, waitMs)
  }

  /** The resident agent reports on or answers an ask in the tab it came from. Nothing else is allowed. */
  sendFromResident(sessionId: string, command: CanvasCommand, actor: string): Promise<RelayResult> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.resident) return Promise.resolve({ ok: false, error: 'That canvas is not open any more.' })
    if (!RESIDENT_OPS.has(command.op)) return Promise.resolve({ ok: false, error: 'The resident agent may only use ask_status and answer.' })
    return this.send(session.userId, command, actor, sessionId)
  }

  private takeAsk(session: Session, raw: unknown) {
    if (!session.resident || typeof raw !== 'object' || raw === null) return
    const ask = raw as AnnouncedAsk
    if (typeof ask.id !== 'string' || !ask.id || ask.id.length > 100 || !Number.isInteger(ask.attempt) || ask.attempt < 0) return
    if (JSON.stringify(ask).length > MAX_ASK_BYTES) return
    if (this.desk.has(session.id, ask)) return
    if (!this.underLimit(session.userId)) {
      void this.send(
        session.userId,
        { op: 'ask_status', input: { id: ask.id, state: 'failed', error: 'Too many asks in a short time. Wait a few minutes, then retry.' } },
        'Paired',
        session.id,
      )
      return
    }
    this.desk.announce(session.id, ask)
  }

  /** Open canvas tabs for this user, most recently connected first. */
  list(userId: string) {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.connectedAt - a.connectedAt)
      .map((s) => ({ id: s.id, title: s.title }))
  }

  /** Sends one command to a tab of this user and waits for its result. */
  send(userId: string, command: CanvasCommand, actor: string, sessionId?: string): Promise<RelayResult> {
    const mine = [...this.sessions.values()].filter((s) => s.userId === userId)
    let session: Session | undefined
    if (sessionId) session = mine.find((s) => s.id === sessionId)
    else if (mine.length === 1) session = mine[0]
    if (!session) {
      const error = sessionId
        ? 'That canvas is not open any more. Call canvas_sessions to see open canvases.'
        : mine.length
          ? `Several canvases are open (${mine.map((s) => s.id).join(', ')}). Pass sessionId; canvas_sessions lists them.`
          : 'No Paired canvas is open for this account. Ask the user to open https://paired.cc/ in a browser, signed in, and try again.'
      return Promise.resolve({ ok: false, error })
    }
    const id = randomUUID()
    const ws = session.ws
    return new Promise<RelayResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: 'The canvas did not answer within 20 seconds. Outcome unknown; read before retrying.' })
      }, TIMEOUT_MS)
      this.pending.set(id, { ws, resolve, timer })
      ws.send(JSON.stringify({ type: 'request', id, requestId: randomUUID(), sessionId: session!.id, actor, command }))
    })
  }

  /** Accepts WebSocket upgrades from signed-in canvas tabs on the same site. */
  attach(server: Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 12 * 1024 * 1024 })
    server.on('upgrade', (request: IncomingMessage, socket, head) => {
      const url = new URL(request.url || '', 'http://relay')
      if (url.pathname !== RELAY_PATH) return
      const origin = request.headers.origin
      let who: Who | undefined
      try {
        const payload = verifyJwt(cookie(request.headers.cookie, 'session') ?? '')
        if (payload.userId) who = { userId: payload.userId, email: payload.email }
      } catch {
        who = undefined
      }
      if (!origin || !this.allowedOrigins.includes(origin) || !who) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws, who!))
    })
    const ping = setInterval(() => {
      for (const client of wss.clients) {
        const live = client as WebSocket & { alive?: boolean }
        if (live.alive === false) {
          client.terminate()
          continue
        }
        live.alive = false
        client.ping()
      }
    }, PING_MS)
    server.on('close', () => clearInterval(ping))
    return wss
  }

  accept(ws: WebSocket, who: Who) {
    const userId = who.userId, resident = this.allowed(who)
    const live = ws as WebSocket & { alive?: boolean }
    live.alive = true
    ws.on('pong', () => (live.alive = true))
    ws.on('message', (data) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(String(data))
      } catch {
        return
      }
      if (message.type === 'hello' && typeof message.sessionId === 'string' && message.sessionId.length <= 100) {
        const existing = this.sessions.get(message.sessionId)
        if (existing && existing.userId !== userId) return ws.close(1008, 'Session belongs to another account')
        for (const [id, s] of this.sessions) if (s.ws === ws && id !== message.sessionId) this.sessions.delete(id)
        const title = typeof message.title === 'string' ? message.title.slice(0, 200) : 'Paired canvas'
        this.sessions.set(message.sessionId, { id: message.sessionId, title, ws, userId, connectedAt: Date.now(), resident })
        // Allowlisted tabs are told who is listening before "connected", so they announce waiting asks knowing it.
        if (resident) ws.send(JSON.stringify({ type: 'listeners', agents: this.desk.listeners() }))
        ws.send(JSON.stringify({ type: 'connected', sessionId: message.sessionId }))
      } else if (message.type === 'ask') {
        const session = [...this.sessions.values()].find((s) => s.ws === ws)
        if (session) this.takeAsk(session, message.ask)
      } else if (message.type === 'response' && typeof message.id === 'string') {
        const request = this.pending.get(message.id)
        if (!request || request.ws !== ws) return
        clearTimeout(request.timer)
        this.pending.delete(message.id)
        request.resolve(
          message.ok === true
            ? { ok: true, result: message.result }
            : { ok: false, error: typeof message.error === 'string' ? message.error : 'Canvas operation failed' },
        )
      }
    })
    ws.on('close', () => {
      for (const [id, s] of this.sessions)
        if (s.ws === ws) {
          this.sessions.delete(id)
          this.desk.dropSession(id)
        }
      for (const [id, p] of this.pending)
        if (p.ws === ws) {
          clearTimeout(p.timer)
          this.pending.delete(id)
          p.resolve({ ok: false, error: 'The canvas closed before answering. Outcome unknown; read before retrying.' })
        }
    })
  }
}
