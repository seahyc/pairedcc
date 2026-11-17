import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import WebSocket from 'ws'
import { once } from 'node:events'
import { canvasRelay } from '../server/relay'

let server: ViteDevServer | undefined
const sockets: WebSocket[] = []
afterEach(async () => {
  for (const socket of sockets) socket.terminate()
  sockets.length = 0
  await server?.close()
  server = undefined
})

describe('real Vite WebSocket lifecycle', () => {
  it('accepts raw socket connections, removes closed sessions, and reconnects', async () => {
    server = await createServer({
      configFile: false,
      logLevel: 'silent',
      plugins: [canvasRelay()],
      server: { host: '127.0.0.1', port: 0 },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('No listening HTTP port')
    const base = `http://127.0.0.1:${address.port}`
    const url = `ws://127.0.0.1:${address.port}/?token=${server.config.webSocketToken}`
    async function connect() {
      const socket = new WebSocket(url, 'vite-hmr', { origin: base })
      sockets.push(socket)
      await once(socket, 'open')
      const response = new Promise<void>((resolve, reject) => {
        socket.on('error', reject)
        socket.on('message', raw => {
          const message = JSON.parse(String(raw))
          if (message.type === 'custom' && message.event === 'paired:connected') resolve()
        })
      })
      socket.send(JSON.stringify({ type: 'custom', event: 'paired:hello', data: { sessionId: 'lifecycle-test', title: 'Connection check' } }))
      await response
      return socket
    }
    const first = await connect()
    const sessions = await fetch(`${base}/api/canvas/sessions`).then(r => r.json())
    expect(sessions.sessions).toEqual([{ id: 'lifecycle-test', title: 'Connection check' }])
    const closed = once(first, 'close')
    first.close()
    await closed
    await expect.poll(async () => {
      const result = await fetch(`${base}/api/canvas/sessions`).then(r => r.json())
      return result.sessions
    }).toEqual([])
    await connect()
    const reconnected = await fetch(`${base}/api/canvas/sessions`)
    expect(reconnected.status).toBe(200)
    expect((await reconnected.json()).sessions).toHaveLength(1)
  })
})
