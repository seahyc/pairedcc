import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Hono } from 'hono'
import { getRequestListener } from '@hono/node-server'
import WebSocket from 'ws'
import { signJwt } from '../src/auth/jwt.js'
import { CanvasRelay } from '../src/canvas/relay.js'
import { createResidentRoutes } from '../src/canvas/resident.js'

const ORIGIN = 'http://localhost:3000'
const SECRET = 'resident-test-secret-0123456789abcdef'

type Stack = { relay: CanvasRelay; server: Server; http: string; ws: string }
const stacks: Stack[] = []

async function start(resident?: ConstructorParameters<typeof CanvasRelay>[1]): Promise<Stack> {
  const relay = new CanvasRelay([ORIGIN], resident)
  const app = new Hono()
  app.route('/', createResidentRoutes(relay))
  const server = createServer(getRequestListener(app.fetch))
  relay.attach(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const stack = { relay, server, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/canvas-relay` }
  stacks.push(stack)
  return stack
}

let on: Stack
beforeAll(async () => {
  on = await start({ secret: SECRET, allow: ['Owner@Example.test', 'id-listed'], maxAsks: 3 })
})
afterAll(() => Promise.all(stacks.map((s) => new Promise<void>((r) => { s.server.closeAllConnections(); s.server.close(() => r()) }))))

/** A fake canvas tab: records what the relay tells it and acknowledges every command. */
function tab(stack: Stack, userId: string, sessionId: string, email = `${userId}@x.test`) {
  const ws = new WebSocket(stack.ws, { headers: { origin: ORIGIN, cookie: `session=${signJwt({ userId, email })}` } })
  const listeners: string[][] = []
  const requests: { op: string; actor: string; input: Record<string, unknown> }[] = []
  const ready = new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', sessionId, title: 'Paired' })))
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw))
      if (m.type === 'listeners') listeners.push(m.agents)
      if (m.type === 'connected') resolve()
      if (m.type === 'request') {
        requests.push({ op: m.command.op, actor: m.actor, input: m.command.input })
        ws.send(JSON.stringify({ type: 'response', id: m.id, ok: true, result: { op: m.command.op, actor: m.actor } }))
      }
    })
    ws.on('error', reject)
  })
  const ask = (id: string, attempt = 0) => ws.send(JSON.stringify({ type: 'ask', ask: { id, attempt, question: `q ${id}` } }))
  return { ws, ready, listeners, requests, ask }
}

const post = (stack: Stack, path: string, body: unknown, secret?: string) =>
  fetch(`${stack.http}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  })
const wait = (stack: Stack, waitMs: number) => post(stack, '/api/canvas/asks/wait', { agent: 'Claude', waitMs }, SECRET).then((r) => r.json())
const until = async (test: () => boolean) => {
  for (let i = 0; i < 100 && !test(); i++) await new Promise((r) => setTimeout(r, 20))
  expect(test()).toBe(true)
}

describe('resident agent channel', () => {
  it('is off entirely when no secret is configured, or the secret is too short to trust', async () => {
    for (const options of [undefined, { allow: ['owner@example.test'] }, { secret: 'short', allow: ['owner@example.test'] }]) {
      const off = await start(options)
      expect((await post(off, '/api/canvas/asks/wait', { agent: 'Claude', waitMs: 0 }, SECRET)).status).toBe(404)
      expect((await post(off, '/api/canvas/asks/wait', { agent: 'Claude', waitMs: 0 }, 'short')).status).toBe(404)
      expect((await post(off, '/api/canvas/command', { sessionId: 's', command: { op: 'answer' } }, SECRET)).status).toBe(404)
      // An allowlisted account is told nothing about listeners and its asks go nowhere.
      const t = tab(off, 'owner', 's-off', 'owner@example.test')
      await t.ready
      t.ask('shape:a')
      await new Promise((r) => setTimeout(r, 50))
      expect(t.listeners).toEqual([])
      expect((await off.relay.waitForAsk('x', 0).promise)).toBeNull()
      t.ws.close()
    }
  })

  it('refuses a missing or wrong secret', async () => {
    expect((await post(on, '/api/canvas/asks/wait', { agent: 'Claude', waitMs: 0 })).status).toBe(401)
    expect((await post(on, '/api/canvas/asks/wait', { agent: 'Claude', waitMs: 0 }, `${SECRET}x`)).status).toBe(401)
    expect((await post(on, '/api/canvas/asks/wait', { agent: 'Claude', waitMs: 0 }, SECRET.slice(0, -1))).status).toBe(401)
    expect((await post(on, '/api/canvas/command', { sessionId: 's', command: { op: 'answer' } }, 'nope')).status).toBe(401)
    expect((await post(on, '/api/canvas/asks/wait', { agent: 'Claude', waitMs: 0 }, SECRET)).status).toBe(200)
  })

  it('never returns asks from an account that is not on the allowlist, and tells it nothing', async () => {
    const stranger = tab(on, 'mallory', 's-mallory', 'mallory@example.test')
    await stranger.ready
    stranger.ask('shape:theirs')
    const polling = wait(on, 150)
    await new Promise((r) => setTimeout(r, 60))
    stranger.ask('shape:theirs', 1)
    expect(await polling).toEqual({ ask: null })
    expect(stranger.listeners).toEqual([])
    // Nor can the resident agent be pointed at that tab.
    const res = await post(on, '/api/canvas/command', { sessionId: 's-mallory', actor: 'Claude', command: { op: 'answer', input: { id: 'shape:theirs', text: 'hi' } } }, SECRET)
    expect(res.status).toBe(422)
    expect(stranger.requests).toEqual([])
    stranger.ws.close()
  })

  it('carries an allowlisted ask to the agent and its answer back to the same tab', async () => {
    const owner = tab(on, 'u-owner', 's-owner', 'owner@example.test') // allowlisted by email, any case
    await owner.ready
    const polling = wait(on, 2000)
    await until(() => owner.listeners.some((l) => l.includes('Claude')))
    owner.ask('shape:mine')
    expect(await polling).toEqual({ sessionId: 's-owner', ask: { id: 'shape:mine', attempt: 0, question: 'q shape:mine' } })
    // A repeated announcement of the same attempt is not handed out twice.
    owner.ask('shape:mine')
    expect(await wait(on, 80)).toEqual({ ask: null })

    const working = await post(on, '/api/canvas/command', { sessionId: 's-owner', actor: 'Claude', command: { op: 'ask_status', input: { id: 'shape:mine', state: 'working' } } }, SECRET)
    expect(await working.json()).toEqual({ ok: true, result: { op: 'ask_status', actor: 'Claude' } })
    const answered = await post(on, '/api/canvas/command', { sessionId: 's-owner', actor: 'Claude', command: { op: 'answer', input: { id: 'shape:mine', text: 'An answer' } } }, SECRET)
    expect(answered.status).toBe(200)
    expect(owner.requests).toEqual([
      { op: 'ask_status', actor: 'Claude', input: { id: 'shape:mine', state: 'working' } },
      { op: 'answer', actor: 'Claude', input: { id: 'shape:mine', text: 'An answer' } },
    ])
    // The resident agent can answer asks; it cannot read or change the rest of the board.
    for (const op of ['read', 'delete', 'create_card']) {
      const res = await post(on, '/api/canvas/command', { sessionId: 's-owner', actor: 'Claude', command: { op, input: {} } }, SECRET)
      expect(res.status).toBe(422)
    }
    expect(owner.requests).toHaveLength(2)
    owner.ws.close()
  })

  it('allows an account listed by id, and fails asks past the per-account limit on the board', async () => {
    const t = tab(on, 'id-listed', 's-listed')
    await t.ready
    for (const id of ['shape:1', 'shape:2', 'shape:3', 'shape:4']) t.ask(id)
    await until(() => t.requests.length === 1)
    expect(t.requests[0]).toMatchObject({ op: 'ask_status', actor: 'Paired', input: { id: 'shape:4', state: 'failed' } })
    expect((await wait(on, 0)).ask.id).toBe('shape:1')
    expect((await wait(on, 0)).ask.id).toBe('shape:2')
    expect((await wait(on, 0)).ask.id).toBe('shape:3')
    expect(await wait(on, 0)).toEqual({ ask: null })
    t.ws.close()
  })

  it('drops queued asks when their tab closes', async () => {
    const stack = await start({ secret: SECRET, allow: ['owner@example.test'] })
    const t = tab(stack, 'u-owner', 's-gone', 'owner@example.test')
    await t.ready
    t.ask('shape:left')
    await new Promise((r) => setTimeout(r, 50))
    t.ws.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(await wait(stack, 0)).toEqual({ ask: null })
  })
})
