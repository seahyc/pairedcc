import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { Hono } from 'hono'
import { signJwt } from '../src/auth/jwt.js'
import { createBoardRoutes } from '../src/canvas/boards/routes.js'
import { MemoryBoardStore, KEEP_REVISIONS, MAX_BOARD_BYTES, type BoardStore, type Snapshot } from '../src/canvas/boards/store.js'
import { PostgresBoardStore } from '../src/canvas/boards/postgres-store.js'

const snap = (text: string, name?: string): Snapshot => ({
  store: {
    ...(name ? { 'document:document': { id: 'document:document', typeName: 'document', name } } : {}),
    'shape:a': { id: 'shape:a', typeName: 'shape', type: 'card', props: { text } },
  },
  schema: { schemaVersion: 2, sequences: {} },
})

/** The same behaviour is required of every store. */
function contract(name: string, make: () => Promise<{ store: BoardStore; users: [string, string] }>) {
  describe(`${name} board store`, () => {
    let store: BoardStore, alice: string, bob: string
    beforeAll(async () => {
      const made = await make()
      store = made.store
      ;[alice, bob] = made.users
    })

    it('creates at revision 1 only when the board does not exist', async () => {
      const r = await store.save(alice, 'b1', { expectedRevision: 0, snapshot: snap('one', 'Field notes') })
      expect(r).toMatchObject({ ok: true, board: { id: 'b1', name: 'Field notes', revision: 1 } })
      const again = await store.save(alice, 'b1', { expectedRevision: 0, snapshot: snap('dup') })
      expect(again).toMatchObject({ ok: false, reason: 'stale', current: { revision: 1 } })
      expect((await store.get(alice, 'b1'))?.snapshot).toEqual(snap('one', 'Field notes'))
    })

    it('saves on the current revision and rejects a stale one without changing the board', async () => {
      expect(await store.save(alice, 'b1', { expectedRevision: 1, snapshot: snap('two') })).toMatchObject({ ok: true, board: { revision: 2, name: 'Field notes' } })
      const stale = await store.save(alice, 'b1', { expectedRevision: 1, snapshot: snap('lost?') })
      expect(stale).toMatchObject({ ok: false, reason: 'stale', current: { revision: 2 } })
      expect((await store.get(alice, 'b1'))?.snapshot).toEqual(snap('two'))
    })

    it('reports a missing board instead of creating it on a non-zero revision', async () => {
      expect(await store.save(alice, 'nope', { expectedRevision: 3, snapshot: snap('x') })).toEqual({ ok: false, reason: 'missing' })
      expect(await store.get(alice, 'nope')).toBeNull()
    })

    it('keeps accounts apart, even for the same board ID', async () => {
      expect(await store.get(bob, 'b1')).toBeNull()
      expect(await store.save(bob, 'b1', { expectedRevision: 1, snapshot: snap('bob') })).toEqual({ ok: false, reason: 'missing' })
      await store.save(bob, 'b1', { expectedRevision: 0, snapshot: snap('bob') })
      expect((await store.get(alice, 'b1'))?.snapshot).toEqual(snap('two'))
      expect((await store.list(bob)).map((b) => b.id)).toEqual(['b1'])
      expect((await store.list(alice)).map((b) => b.id)).toEqual(['b1'])
    })

    it('lets exactly one of several concurrent saves on the same revision win', async () => {
      const results = await Promise.all([0, 1, 2, 3, 4].map((i) => store.save(alice, 'b1', { expectedRevision: 2, snapshot: snap(`race ${i}`) })))
      const winners = results.filter((r) => r.ok)
      expect(winners).toHaveLength(1)
      expect(results.filter((r) => !r.ok && r.reason === 'stale')).toHaveLength(4)
      const board = await store.get(alice, 'b1')
      expect(board?.revision).toBe(3)
    })

    it('keeps recent revisions, newest first, and prunes old ones', async () => {
      await store.save(alice, 'hist', { expectedRevision: 0, snapshot: snap('r1') })
      for (let r = 1; r < KEEP_REVISIONS + 5; r++) await store.save(alice, 'hist', { expectedRevision: r, snapshot: snap(`r${r + 1}`) })
      const list = (await store.revisions(alice, 'hist'))!
      expect(list).toHaveLength(KEEP_REVISIONS)
      expect(list[0].revision).toBe(KEEP_REVISIONS + 5)
      expect(list.at(-1)!.revision).toBe(6)
      expect((await store.revision(alice, 'hist', 10))?.snapshot).toEqual(snap('r10'))
      expect(await store.revision(alice, 'hist', 2)).toBeNull()
      expect(await store.revisions(bob, 'hist')).toBeNull()
    })

    it('removes only on the current revision', async () => {
      await store.save(alice, 'gone', { expectedRevision: 0, snapshot: snap('x') })
      await store.save(alice, 'gone', { expectedRevision: 1, snapshot: snap('y') })
      expect(await store.remove(alice, 'gone', 1)).toMatchObject({ ok: false, reason: 'stale', current: { revision: 2 } })
      expect(await store.remove(bob, 'gone', 2)).toEqual({ ok: false, reason: 'missing' })
      expect(await store.remove(alice, 'gone', 2)).toEqual({ ok: true })
      expect(await store.get(alice, 'gone')).toBeNull()
      expect(await store.revisions(alice, 'gone')).toBeNull()
    })
  })
}

contract('memory', async () => ({ store: new MemoryBoardStore(), users: [randomUUID(), randomUUID()] }))

// Runs against a real database when TEST_DATABASE_URL points at an empty Postgres;
// the migrations are applied to it first.
const testDb = process.env.TEST_DATABASE_URL
describe.runIf(Boolean(testDb))('postgres', () => {
  let sql: postgres.Sql
  afterAll(async () => sql?.end())
  contract('postgres', async () => {
    sql = postgres(testDb!, { onnotice: () => undefined })
    await sql`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`
    const dir = new URL('../src/db/migrations/', import.meta.url)
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if ((await sql`SELECT 1 FROM _migrations WHERE name = ${file}`).length) continue
      await sql.unsafe(await readFile(new URL(file, dir), 'utf8'))
      await sql`INSERT INTO _migrations (name) VALUES (${file})`
    }
    const users = [randomUUID(), randomUUID()] as [string, string]
    for (const id of users) await sql`INSERT INTO users (id, email) VALUES (${id}, ${`${id}@boards.test`})`
    return { store: new PostgresBoardStore(sql), users }
  })
})

describe('board routes', () => {
  const app = new Hono().route('/api/canvas/boards', createBoardRoutes(new MemoryBoardStore()))
  const alice = { Authorization: `Bearer ${signJwt({ userId: randomUUID(), email: 'alice@boards.test' })}` }
  const bob = { Authorization: `Bearer ${signJwt({ userId: randomUUID(), email: 'bob@boards.test' })}` }
  const put = (id: string, body: unknown, headers = alice) =>
    app.request(`/api/canvas/boards/${id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('requires a signed-in account', async () => {
    expect((await app.request('/api/canvas/boards')).status).toBe(401)
    expect((await app.request('/api/canvas/boards', { headers: { Authorization: 'Bearer forged' } })).status).toBe(401)
  })

  it('creates, loads, saves and rejects a stale save with the current revision', async () => {
    const created = await put('main', { expectedRevision: 0, snapshot: snap('hello', 'Untitled exploration') })
    expect(created.status).toBe(201)
    expect((await created.json()).board).toMatchObject({ id: 'main', revision: 1 })
    expect((await put('main', { expectedRevision: 1, name: 'Energy study', snapshot: snap('edited') })).status).toBe(200)
    const stale = await put('main', { expectedRevision: 1, snapshot: snap('older tab') })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: expect.stringContaining('Board changed'), current: { revision: 2, name: 'Energy study' } })
    const loaded = await (await app.request('/api/canvas/boards/main', { headers: alice })).json()
    expect(loaded.board).toMatchObject({ revision: 2, name: 'Energy study', snapshot: snap('edited') })
    const list = await (await app.request('/api/canvas/boards', { headers: alice })).json()
    expect(list.boards.map((b: { id: string }) => b.id)).toEqual(['main'])
    expect(list.boards[0]).not.toHaveProperty('snapshot')
  })

  it("hides one account's boards from another", async () => {
    expect((await app.request('/api/canvas/boards/main', { headers: bob })).status).toBe(404)
    expect((await put('main', { expectedRevision: 2, snapshot: snap('bob') }, bob)).status).toBe(404)
    expect((await (await app.request('/api/canvas/boards', { headers: bob })).json()).boards).toEqual([])
  })

  it('validates IDs, bodies and size', async () => {
    expect((await put('bad id!', { expectedRevision: 0, snapshot: snap('x') })).status).toBe(400)
    expect((await put('v', { expectedRevision: 0, snapshot: { store: {} } })).status).toBe(400)
    expect((await put('v', { expectedRevision: -1, snapshot: snap('x') })).status).toBe(400)
    expect((await put('v', { expectedRevision: 0, snapshot: snap('x'), extra: true })).status).toBe(400)
    const malformed = await app.request('/api/canvas/boards/v', { method: 'PUT', headers: { ...alice, 'Content-Type': 'application/json' }, body: '{' })
    expect(malformed.status).toBe(400)
    const huge = await put('v', { expectedRevision: 0, snapshot: snap('x'.repeat(MAX_BOARD_BYTES + 100 * 1024)) })
    expect(huge.status).toBe(413)
  })

  it('lists revisions, serves one, and deletes only on the current revision', async () => {
    const revs = await (await app.request('/api/canvas/boards/main/revisions', { headers: alice })).json()
    expect(revs.revisions.map((r: { revision: number }) => r.revision)).toEqual([2, 1])
    const first = await (await app.request('/api/canvas/boards/main/revisions/1', { headers: alice })).json()
    expect(first.revision.snapshot).toEqual(snap('hello', 'Untitled exploration'))
    expect((await app.request('/api/canvas/boards/main?expectedRevision=1', { method: 'DELETE', headers: alice })).status).toBe(409)
    expect((await app.request('/api/canvas/boards/main', { method: 'DELETE', headers: alice })).status).toBe(400)
    expect((await app.request('/api/canvas/boards/main?expectedRevision=2', { method: 'DELETE', headers: alice })).status).toBe(204)
    expect((await app.request('/api/canvas/boards/main', { headers: alice })).status).toBe(404)
  })
})
