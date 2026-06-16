import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import { attachYjsWebSocket } from '../src/yjs/ws-handler.js'
import { DocManager } from '../src/yjs/doc-manager.js'

/**
 * Root-cause regression test for the periodic "Reconnecting…" banner. The bug:
 * an idle connection received no traffic, so the y-websocket client force-
 * closed it after its 30s `messageReconnectTimeout` and reconnected — flashing
 * the yellow banner on every idle doc. The fix: the server pings clients on an
 * interval, so the client always sees traffic and stays connected.
 *
 * We run the handler with a tiny ping interval and assert (a) an idle client
 * receives server pings and stays open, and (b) a client that stops ponging is
 * terminated.
 */
describe('yjs ws keep-alive', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()))
    server = undefined
  })

  async function start(pingMs: number) {
    const docManager = new DocManager()
    server = createServer()
    attachYjsWebSocket(server, docManager, pingMs)
    await new Promise<void>((resolve) => server!.listen(0, resolve))
    const { port } = server!.address() as { port: number }
    return port
  }

  it('sends periodic pings to an idle client, keeping it connected', async () => {
    const port = await start(40)
    const ws = new WebSocket(`ws://localhost:${port}/ws/idle-doc`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    let pings = 0
    ws.on('ping', () => { pings++ }) // ws auto-replies with pong

    await new Promise((r) => setTimeout(r, 200))
    expect(pings).toBeGreaterThanOrEqual(2)
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('terminates a client that stops responding to pings', async () => {
    const port = await start(40)
    const ws = new WebSocket(`ws://localhost:${port}/ws/dead-doc`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    // Suppress the automatic pong so the server marks this client dead.
    ws.pong = () => {}
    // @ts-expect-error — reach into the underlying socket to drop incoming pings.
    ws._receiver.removeAllListeners('ping')

    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()))
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('not terminated')), 1000)),
    ])
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })
})
