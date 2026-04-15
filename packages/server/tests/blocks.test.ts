import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import {
  BLOCKS_MAP_KEY,
  generateAnchor,
  isAnchor,
  upsertBlock,
  readBlockSnapshot,
  deleteBlock,
  listBlocks,
} from '../src/yjs/blocks.js'

describe('ComponentBlock substrate', () => {
  let doc: Y.Doc

  beforeEach(() => {
    doc = new Y.Doc()
  })

  it('generates URL-safe anchors that match isAnchor', () => {
    for (let i = 0; i < 50; i++) {
      const a = generateAnchor()
      expect(a).toMatch(/^b-[a-z0-9]+$/)
      expect(isAnchor(a)).toBe(true)
    }
    expect(isAnchor('not-an-anchor')).toBe(false)
    expect(isAnchor('b-')).toBe(false)
    expect(isAnchor('')).toBe(false)
  })

  it('upserts a new block and reads it back', () => {
    const anchor = 'b-test1234'
    upsertBlock(doc, anchor, {
      type: 'react',
      props: { entry: 'Counter.tsx' },
      state: { count: 0 },
    })
    const snap = readBlockSnapshot(doc, anchor)
    expect(snap).toEqual({
      anchor,
      type: 'react',
      props: { entry: 'Counter.tsx' },
      state: { count: 0 },
    })
  })

  it('updates only supplied fields, leaves others intact', () => {
    const anchor = 'b-test5678'
    upsertBlock(doc, anchor, { type: 'chart', props: { kind: 'line' }, state: { x: 1 } })
    upsertBlock(doc, anchor, { state: { x: 2, y: 3 } })
    const snap = readBlockSnapshot(doc, anchor)!
    expect(snap.type).toBe('chart')
    expect(snap.props).toEqual({ kind: 'line' })
    expect(snap.state).toEqual({ x: 2, y: 3 })
  })

  it('returns null for missing anchors', () => {
    expect(readBlockSnapshot(doc, 'b-missing')).toBeNull()
  })

  it('deletes blocks idempotently', () => {
    upsertBlock(doc, 'b-todelete', { type: 'react', props: {} })
    expect(readBlockSnapshot(doc, 'b-todelete')).not.toBeNull()
    deleteBlock(doc, 'b-todelete')
    expect(readBlockSnapshot(doc, 'b-todelete')).toBeNull()
    // Second delete is a no-op, doesn't throw
    deleteBlock(doc, 'b-todelete')
    deleteBlock(doc, 'b-never-existed')
  })

  it('lists all blocks', () => {
    upsertBlock(doc, 'b-one', { type: 'react', props: { i: 1 } })
    upsertBlock(doc, 'b-two', { type: 'chart', props: { i: 2 } })
    upsertBlock(doc, 'b-three', { type: 'pullquote', props: { text: 'hi' } })
    const all = listBlocks(doc)
    expect(all.map(b => b.anchor).sort()).toEqual(['b-one', 'b-three', 'b-two'])
    expect(all.find(b => b.anchor === 'b-two')?.type).toBe('chart')
  })

  it('block state survives round-trip through Yjs encode/decode', () => {
    upsertBlock(doc, 'b-roundtrip', {
      type: 'duckdb',
      props: { schema: 'sales' },
      state: { query: 'SELECT 1' },
    })
    const update = Y.encodeStateAsUpdate(doc)

    const fresh = new Y.Doc()
    Y.applyUpdate(fresh, update)
    const snap = readBlockSnapshot(fresh, 'b-roundtrip')
    expect(snap).toEqual({
      anchor: 'b-roundtrip',
      type: 'duckdb',
      props: { schema: 'sales' },
      state: { query: 'SELECT 1' },
    })
  })

  it('two clients converge on the same block state via CRDT', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()

    upsertBlock(a, 'b-shared', { type: 'react', state: { count: 1 } })
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

    // Both edit different state fields concurrently
    upsertBlock(a, 'b-shared', { state: { count: 2 } })
    upsertBlock(b, 'b-shared', { state: { label: 'x' } })

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

    const aSnap = readBlockSnapshot(a, 'b-shared')!
    const bSnap = readBlockSnapshot(b, 'b-shared')!
    // Order of last-writer-wins on `count` is implementation-defined, but both
    // should agree, AND both should preserve the `label` field set on b.
    expect(aSnap.state).toEqual(bSnap.state)
    expect(aSnap.state.label).toBe('x')
    expect([1, 2]).toContain(aSnap.state.count)
  })

  it('uses the canonical Y.Map key', () => {
    upsertBlock(doc, 'b-keytest', { type: 'react' })
    expect(doc.share.has(BLOCKS_MAP_KEY)).toBe(true)
  })
})
