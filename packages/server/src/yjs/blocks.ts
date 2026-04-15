/**
 * ComponentBlock substrate (server side). Mirrors packages/web/src/blocks/schema.ts.
 *
 * Both sides need the same Y.Map layout to round-trip:
 *   doc.getMap('pccBlocks')  →  Y.Map<anchor, Y.Map { type, props, state }>
 */

import * as Y from 'yjs'

export const BLOCKS_MAP_KEY = 'pccBlocks'
export const BLOCK_FIELD_TYPE = 'type'
export const BLOCK_FIELD_PROPS = 'props'
export const BLOCK_FIELD_STATE = 'state'

export interface BlockSnapshot {
  anchor: string
  type: string
  props: unknown
  state: Record<string, unknown>
}

export function generateAnchor(): string {
  const r = Math.random().toString(36).slice(2, 11).padEnd(9, '0')
  return `b-${r}`
}

export function isAnchor(s: string): boolean {
  return /^b-[a-z0-9]{6,}$/i.test(s)
}

export function readBlockSnapshot(doc: Y.Doc, anchor: string): BlockSnapshot | null {
  const blocks = doc.getMap(BLOCKS_MAP_KEY)
  const entry = blocks.get(anchor) as Y.Map<unknown> | undefined
  if (!entry) return null
  const type = entry.get(BLOCK_FIELD_TYPE) as string | undefined
  if (!type) return null
  const props = entry.get(BLOCK_FIELD_PROPS)
  const stateMap = entry.get(BLOCK_FIELD_STATE) as Y.Map<unknown> | undefined
  const state: Record<string, unknown> = {}
  if (stateMap) {
    stateMap.forEach((v, k) => {
      state[k] = v instanceof Object && 'toJSON' in v ? (v as any).toJSON() : v
    })
  }
  return { anchor, type, props, state }
}

export function upsertBlock(
  doc: Y.Doc,
  anchor: string,
  patch: { type?: string; props?: unknown; state?: Record<string, unknown> },
): void {
  doc.transact(() => {
    const blocks = doc.getMap(BLOCKS_MAP_KEY)
    let entry = blocks.get(anchor) as Y.Map<unknown> | undefined
    if (!entry) {
      entry = new Y.Map()
      blocks.set(anchor, entry)
    }
    if (patch.type !== undefined) entry.set(BLOCK_FIELD_TYPE, patch.type)
    if (patch.props !== undefined) entry.set(BLOCK_FIELD_PROPS, patch.props)
    if (patch.state !== undefined) {
      let stateMap = entry.get(BLOCK_FIELD_STATE) as Y.Map<unknown> | undefined
      if (!stateMap) {
        stateMap = new Y.Map()
        entry.set(BLOCK_FIELD_STATE, stateMap)
      }
      for (const [k, v] of Object.entries(patch.state)) stateMap.set(k, v)
    }
  })
}

export function deleteBlock(doc: Y.Doc, anchor: string): void {
  const blocks = doc.getMap(BLOCKS_MAP_KEY)
  if (blocks.has(anchor)) {
    doc.transact(() => blocks.delete(anchor))
  }
}

export function listBlocks(doc: Y.Doc): BlockSnapshot[] {
  const blocks = doc.getMap(BLOCKS_MAP_KEY)
  const out: BlockSnapshot[] = []
  blocks.forEach((_, anchor) => {
    const snap = readBlockSnapshot(doc, anchor)
    if (snap) out.push(snap)
  })
  return out
}
