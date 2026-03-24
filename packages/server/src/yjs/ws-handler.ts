import { createNodeWebSocket } from '@hono/node-ws'
import type { Hono } from 'hono'
import * as Y from 'yjs'
import { DocManager } from './doc-manager.js'
import { detectMentions } from './mention-detector.js'
import { PostgresSnapshotStore } from './snapshot-store.js'
import { PresenceTracker } from '../presence/tracker.js'
import { redis } from '../redis.js'

interface Client {
  ws: WebSocket
  docId: string
  userId: string
  name: string
  isAgent: boolean
}

const snapshotTimers = new Map<string, NodeJS.Timeout>()

function scheduleAutoSnapshot(docId: string, docManager: DocManager, store: PostgresSnapshotStore) {
  if (snapshotTimers.has(docId)) return
  const timer = setInterval(async () => {
    const state = docManager.getState(docId)
    if (state) {
      try {
        await store.save(docId, state, { authorId: 'system', authorType: 'human', description: 'auto-save' })
      } catch (e) {
        console.error(`Auto-snapshot failed for ${docId}:`, e)
      }
    }
  }, 5 * 60 * 1000)
  snapshotTimers.set(docId, timer)
}

export function setupWebSocket(app: Hono, docManager: DocManager, presenceTracker: PresenceTracker) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as any })
  const clients = new Map<WebSocket, Client>()
  const snapshotStore = new PostgresSnapshotStore()

  app.get('/ws/:docId', upgradeWebSocket((c) => {
    const docId = c.req.param('docId')

    return {
      onOpen(evt, ws) {
        const rawWs = ws.raw as WebSocket
        const client: Client = {
          ws: rawWs,
          docId,
          userId: 'anonymous',
          name: 'Anonymous',
          isAgent: false,
        }
        clients.set(rawWs, client)

        // Track presence
        presenceTracker.join(docId, client.userId, client.name, client.isAgent)

        // Schedule auto-snapshots for this doc
        scheduleAutoSnapshot(docId, docManager, snapshotStore)

        // Send current doc state
        const state = docManager.getState(docId)
        if (state) {
          ws.send(state)
        }
      },

      onMessage(evt, ws) {
        const rawWs = ws.raw as WebSocket
        const client = clients.get(rawWs)
        if (!client) return

        const data = evt.data
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
          const update = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer)
          docManager.applyUpdate(client.docId, update)

          // Broadcast to all other clients in the same doc
          for (const [otherWs, otherClient] of clients) {
            if (otherClient.docId === client.docId && otherWs !== rawWs) {
              try { otherWs.send(update) } catch {}
            }
          }

          // Detect mentions
          const newMentions = detectMentions(docManager.getOrCreate(client.docId))
          for (const mention of newMentions) {
            const mentionData = JSON.stringify(mention)
            redis.rpush(`mentions:${client.docId}:*`, mentionData).catch(() => {})
          }
        }
      },

      onClose(evt, ws) {
        const rawWs = ws.raw as WebSocket
        const client = clients.get(rawWs)
        if (client) {
          presenceTracker.leave(client.docId, client.userId)
        }
        clients.delete(rawWs)
      },
    }
  }))

  return { injectWebSocket }
}
