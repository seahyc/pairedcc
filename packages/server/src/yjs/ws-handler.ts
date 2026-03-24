import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { DocManager } from './doc-manager.js'

const messageSync = 0
const messageAwareness = 1

interface ConnClient {
  ws: WebSocket
  docId: string
  awareness: awarenessProtocol.Awareness
}

// Export awarenesses so agent API can set cursor positions
export const docAwarenesses = new Map<string, awarenessProtocol.Awareness>()

/**
 * Custom y-websocket compatible server that uses OUR DocManager
 * instead of y-websocket's internal doc store.
 * This ensures the agent API and WebSocket clients share the same docs.
 */
export function attachYjsWebSocket(server: any, docManager: DocManager) {
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Map<WebSocket, ConnClient>()
  const awarenesses = new Map<string, awarenessProtocol.Awareness>()

  function getAwareness(docId: string, doc: Y.Doc): awarenessProtocol.Awareness {
    let awareness = awarenesses.get(docId)
    if (!awareness) {
      awareness = new awarenessProtocol.Awareness(doc)
      awarenesses.set(docId, awareness)
      docAwarenesses.set(docId, awareness) // expose for agent API
    }
    return awareness
  }

  function broadcastToDoc(docId: string, message: Uint8Array, exclude?: WebSocket) {
    for (const [ws, client] of clients) {
      if (client.docId === docId && ws !== exclude && ws.readyState === WebSocket.OPEN) {
        try { ws.send(message) } catch {}
      }
    }
  }

  server.on('upgrade', (request: any, socket: any, head: any) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`)
    if (!url.pathname.startsWith('/ws/')) return

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws: WebSocket, request: any) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`)
    const docId = decodeURIComponent(url.pathname.replace('/ws/', ''))
    console.log(`[yjs-ws] Client connected to doc: "${docId}"`)

    const doc = docManager.getOrCreate(docId)
    // Pre-initialize the XmlFragment that Tiptap uses — this MUST happen
    // before any sync messages so Yjs knows the correct type for 'default'
    doc.getXmlFragment('default')
    const awareness = getAwareness(docId, doc)

    clients.set(ws, { ws, docId, awareness })

    // Send sync step 1 to new client
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, doc)
    ws.send(encoding.toUint8Array(encoder))

    // Send awareness states
    const awarenessEncoder = encoding.createEncoder()
    encoding.writeVarUint(awarenessEncoder, messageAwareness)
    encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys())))
    ws.send(encoding.toUint8Array(awarenessEncoder))

    // Listen for doc updates and broadcast
    const onUpdate = (update: Uint8Array, origin: any) => {
      if (origin === ws) return // don't echo back to sender
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeUpdate(encoder, update)
      broadcastToDoc(docId, encoding.toUint8Array(encoder), undefined)
    }
    doc.on('update', onUpdate)

    // Listen for awareness changes
    const onAwarenessChange = ({ added, updated, removed }: any) => {
      const changedClients = [...added, ...updated, ...removed]
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients))
      broadcastToDoc(docId, encoding.toUint8Array(encoder))
    }
    awareness.on('change', onAwarenessChange)

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const message = new Uint8Array(data instanceof ArrayBuffer ? data : (Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[])))
      const decoder = decoding.createDecoder(message)
      const messageType = decoding.readVarUint(decoder)

      console.log(`[yjs-ws] Message type=${messageType} size=${message.length} doc="${docId}" sharedKeys=[${Array.from(doc.share.keys())}]`)

      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, messageSync)
          syncProtocol.readSyncMessage(decoder, encoder, doc, ws)
          const reply = encoding.toUint8Array(encoder)
          if (reply.length > 1) {
            ws.send(reply)
          }
          break
        }
        case messageAwareness: {
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws)
          break
        }
      }
    })

    ws.on('close', () => {
      doc.off('update', onUpdate)
      awareness.off('change', onAwarenessChange)
      clients.delete(ws)
      console.log(`[yjs-ws] Client disconnected from doc: "${docId}"`)
    })
  })

  console.log('Yjs WebSocket server attached (custom sync protocol)')
  return wss
}
