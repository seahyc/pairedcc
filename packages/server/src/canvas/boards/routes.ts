import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { requireAuth } from '../../auth/middleware.js'
import { MAX_BOARD_BYTES, boardIdSchema, byteSize, saveSchema, type BoardStore } from './store.js'

// /api/canvas/boards: the signed-in account's canvas boards.
//   GET    /                      list (newest first, no snapshots)
//   GET    /:id                   board with snapshot
//   PUT    /:id                   { expectedRevision, name?, snapshot } → { board } | 409 { error, current }
//   DELETE /:id?expectedRevision= → 204 | 409
//   GET    /:id/revisions         recent revisions, newest first
//   GET    /:id/revisions/:rev    one revision's snapshot
// A stale expectedRevision never overwrites: the client reloads the current board and
// decides what to keep, as with stale object writes in the canvas.

const TOO_LARGE = `Boards are limited to ${MAX_BOARD_BYTES / 1024 / 1024} MB`
const STALE = 'Board changed. Load its current revision before saving.'

export function createBoardRoutes(store: BoardStore) {
  const app = new Hono()
  app.use('*', requireAuth)

  const id = (raw: string) => boardIdSchema.safeParse(raw)

  app.get('/', async (c) => c.json({ boards: await store.list(c.get('user').userId) }))

  app.get('/:id', async (c) => {
    const parsed = id(c.req.param('id'))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
    const board = await store.get(c.get('user').userId, parsed.data)
    return board ? c.json({ board }) : c.json({ error: 'Board not found' }, 404)
  })

  app.put(
    '/:id',
    bodyLimit({ maxSize: MAX_BOARD_BYTES + 64 * 1024, onError: (c) => c.json({ error: TOO_LARGE }, 413) }),
    async (c) => {
      const parsed = id(c.req.param('id'))
      if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
      let body: unknown
      try {
        body = await c.req.json()
      } catch (error) {
        // Without a Content-Length the limit trips while the body is read.
        if (error instanceof Error && error.name === 'BodyLimitError') return c.json({ error: TOO_LARGE }, 413)
        return c.json({ error: 'Body must be JSON' }, 400)
      }
      const input = saveSchema.safeParse(body)
      if (!input.success) {
        const issue = input.error.issues[0]
        return c.json({ error: `${issue.path.join('.') || 'body'}: ${issue.message}` }, 400)
      }
      if (byteSize(input.data.snapshot) > MAX_BOARD_BYTES) return c.json({ error: TOO_LARGE }, 413)
      const result = await store.save(c.get('user').userId, parsed.data, input.data)
      if (result.ok) return c.json({ board: result.board }, input.data.expectedRevision === 0 ? 201 : 200)
      if (result.reason === 'missing') return c.json({ error: 'Board not found. Save with expectedRevision 0 to create it.' }, 404)
      return c.json({ error: STALE, current: result.current }, 409)
    },
  )

  app.delete('/:id', async (c) => {
    const parsed = id(c.req.param('id'))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
    const expected = Number(c.req.query('expectedRevision'))
    if (!Number.isInteger(expected) || expected < 1) return c.json({ error: 'expectedRevision query parameter is required' }, 400)
    const result = await store.remove(c.get('user').userId, parsed.data, expected)
    if (result.ok) return c.body(null, 204)
    if (result.reason === 'missing') return c.json({ error: 'Board not found' }, 404)
    return c.json({ error: STALE, current: result.current }, 409)
  })

  app.get('/:id/revisions', async (c) => {
    const parsed = id(c.req.param('id'))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
    const revisions = await store.revisions(c.get('user').userId, parsed.data)
    return revisions ? c.json({ revisions }) : c.json({ error: 'Board not found' }, 404)
  })

  app.get('/:id/revisions/:rev', async (c) => {
    const parsed = id(c.req.param('id'))
    const rev = Number(c.req.param('rev'))
    if (!parsed.success || !Number.isInteger(rev) || rev < 1) return c.json({ error: 'Invalid board ID or revision' }, 400)
    const revision = await store.revision(c.get('user').userId, parsed.data, rev)
    return revision ? c.json({ revision }) : c.json({ error: 'Revision not found' }, 404)
  })

  return app
}
