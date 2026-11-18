import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { signJwt } from '../src/auth/jwt.js'
import { CanvasRelay } from '../src/canvas/relay.js'
import { buildMcpServer } from '../src/canvas/mcp.js'

const ORIGIN = 'http://localhost:3000'
let server: Server
let relay: CanvasRelay
let url: string

beforeAll(async () => {
  relay = new CanvasRelay([ORIGIN])
  server = createServer()
  relay.attach(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/canvas-relay`
})
afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()) }))

/** A fake canvas tab that answers every request with its op and actor. */
function tab(userId: string, sessionId: string, origin = ORIGIN) {
  const ws = new WebSocket(url, { headers: { origin, cookie: `session=${signJwt({ userId, email: `${userId}@x.test` })}` } })
  const ready = new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', sessionId, title: 'Paired' })))
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw))
      if (m.type === 'connected') resolve()
      if (m.type === 'request') {
        const result = m.command.op === 'screenshot' ? { data: 'iVBORw0KGgo=', mimeType: 'image/png' } : { op: m.command.op, actor: m.actor, input: m.command.input }
        ws.send(JSON.stringify({ type: 'response', id: m.id, ok: true, result }))
      }
    })
    ws.on('error', reject)
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })
  return { ws, ready }
}

describe('canvas relay', () => {
  it('rejects tabs from another origin or without a session', async () => {
    await expect(tab('u1', 's-x', 'https://evil.example').ready).rejects.toThrow('403')
    const anon = new WebSocket(url, { headers: { origin: ORIGIN } })
    await expect(new Promise((_, reject) => anon.on('unexpected-response', (_q, r) => reject(new Error(`HTTP ${r.statusCode}`))))).rejects.toThrow('403')
  })

  it('only reaches the signed-in user\'s own tabs', async () => {
    const mine = tab('alice', 's-alice')
    const theirs = tab('bob', 's-bob')
    await Promise.all([mine.ready, theirs.ready])
    expect(relay.list('alice')).toEqual([{ id: 's-alice', title: 'Paired' }])
    const ok = await relay.send('alice', { op: 'read', input: {} }, 'Claude Code')
    expect(ok).toEqual({ ok: true, result: { op: 'read', actor: 'Claude Code', input: {} } })
    const wrong = await relay.send('alice', { op: 'read' }, 'Claude Code', 's-bob')
    expect(wrong.ok).toBe(false)
    mine.ws.close()
    theirs.ws.close()
  })

  it('asks for a sessionId when several tabs are open, and explains when none are', async () => {
    expect((await relay.send('carol', { op: 'read' }, 'A')) as { error: string }).toMatchObject({ ok: false, error: expect.stringContaining('No Paired canvas is open') })
    const a = tab('carol', 's-c1'), b = tab('carol', 's-c2')
    await Promise.all([a.ready, b.ready])
    expect((await relay.send('carol', { op: 'read' }, 'A')) as { error: string }).toMatchObject({ ok: false, error: expect.stringContaining('Several canvases') })
    expect((await relay.send('carol', { op: 'read' }, 'A', 's-c2')).ok).toBe(true)
    a.ws.close()
    b.ws.close()
  })

  it('serves the canvas tools over MCP and forwards calls to the tab', async () => {
    const t = tab('dana', 's-dana')
    await t.ready
    const mcp = buildMcpServer(relay, { userId: 'dana', agent: 'Codex' })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverSide)
    const client = new Client({ name: 'test', version: '1' })
    await client.connect(clientSide)
    const { tools } = await client.listTools()
    expect(tools.map((x) => x.name)).toContain('canvas_read')
    const sessions = await client.callTool({ name: 'canvas_sessions', arguments: {} })
    expect(JSON.parse((sessions.content as { text: string }[])[0].text).sessions).toEqual([{ id: 's-dana', title: 'Paired' }])
    const read = await client.callTool({ name: 'canvas_read', arguments: { ids: ['shape:a'] } })
    expect(JSON.parse((read.content as { text: string }[])[0].text)).toEqual({ op: 'read', actor: 'Codex', input: { ids: ['shape:a'] } })
    const shot = await client.callTool({ name: 'canvas_screenshot', arguments: {} })
    expect(shot.content).toEqual([{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }])
    t.ws.close()
    await client.close()
  })
})
