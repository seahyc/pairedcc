import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware.js'
import { PostgresSnapshotStore } from '../yjs/snapshot-store.js'

const store = new PostgresSnapshotStore()

export const snapshotRoutes = new Hono()

snapshotRoutes.use('*', requireAuth)

// List snapshots for a document
snapshotRoutes.get('/:docId/snapshots', async (c) => {
  const docId = c.req.param('docId')
  const snapshots = await store.list(docId)
  return c.json(snapshots)
})

// Restore a specific snapshot (creates a new snapshot from old state)
snapshotRoutes.post('/:docId/snapshots/:snapshotId/restore', async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('docId')
  const snapshotId = c.req.param('snapshotId')

  const data = await store.loadById(snapshotId)
  if (!data) return c.json({ error: 'Snapshot not found' }, 404)

  await store.save(docId, data, {
    authorId: userId,
    authorType: 'human',
    description: `Restored from snapshot ${snapshotId}`,
  })

  return c.json({ ok: true, description: 'Restored' })
})
