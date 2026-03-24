import { WebSocketServer } from 'ws'
import type { Server } from 'http'
// @ts-ignore — y-websocket/bin/utils has no types
import { setupWSConnection, getYDoc } from 'y-websocket/bin/utils'

/**
 * Attach a y-websocket compatible WebSocket server to the Node HTTP server.
 * The y-websocket client (WebsocketProvider) expects this protocol.
 *
 * Routes: /ws/<docId> — the room name is the docId.
 */
export function attachYjsWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`)

    // Only handle /ws/* paths
    if (!url.pathname.startsWith('/ws/')) {
      // Let other upgrade handlers (like Vite HMR) pass through
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws: any, request: any) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`)
    // Extract docId from /ws/<docId>
    const docId = url.pathname.replace('/ws/', '')

    // setupWSConnection handles the full y-websocket sync protocol
    // (sync step 1/2, awareness, updates)
    setupWSConnection(ws, request, { docName: docId })
  })

  console.log('Yjs WebSocket server attached')
  return wss
}
