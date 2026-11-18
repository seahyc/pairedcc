import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { verifyJwt } from '../auth/jwt.js'

// Carries agent commands from /mcp to the signed-in user's open canvas tabs.
// The board itself still lives in the browser; this relay only forwards
// commands and their results, and only between tabs and agents of one user.

export const RELAY_PATH = '/canvas-relay'
const TIMEOUT_MS = 20_000
const PING_MS = 25_000

type Session = { id: string; title: string; ws: WebSocket; userId: string; connectedAt: number }
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

  constructor(private allowedOrigins: string[]) {}

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
      let userId: string | undefined
      try {
        userId = verifyJwt(cookie(request.headers.cookie, 'session') ?? '').userId
      } catch {
        userId = undefined
      }
      if (!origin || !this.allowedOrigins.includes(origin) || !userId) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws, userId!))
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

  accept(ws: WebSocket, userId: string) {
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
        this.sessions.set(message.sessionId, { id: message.sessionId, title, ws, userId, connectedAt: Date.now() })
        ws.send(JSON.stringify({ type: 'connected', sessionId: message.sessionId }))
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
      for (const [id, s] of this.sessions) if (s.ws === ws) this.sessions.delete(id)
      for (const [id, p] of this.pending)
        if (p.ws === ws) {
          clearTimeout(p.timer)
          this.pending.delete(id)
          p.resolve({ ok: false, error: 'The canvas closed before answering. Outcome unknown; read before retrying.' })
        }
    })
  }
}
