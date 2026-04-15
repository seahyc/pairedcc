/**
 * ComponentBlock substrate — the agent-as-peer canvas primitive.
 *
 * Every interactive block (chart, duckdb, react app, scrollytelling, ...) is
 * the same shape: a typed entry in a Yjs Map, addressable by a stable anchor,
 * with both static props and a live CRDT-state object.
 *
 * Storage layout in a Y.Doc:
 *   doc.getMap('pccBlocks')  →  Y.Map<anchor, BlockEntry>
 *
 * Each BlockEntry is itself a Y.Map with three keys:
 *   - type:  string                 — renderer registry key
 *   - props: any (JSON-serializable) — author-supplied initial config
 *   - state: Y.Map (optional)        — live CRDT state shared by all viewers
 *
 * The Tiptap node `pccBlock` only stores the anchor in its attrs. Rendering
 * looks up the Y.Map entry and dispatches to the registered renderer.
 *
 * This module is the source of truth for the schema. Both the web client and
 * the server import from a parallel copy at packages/server/src/yjs/blocks.ts
 * (kept in sync by hand — the surface is small).
 */

import * as Y from 'yjs'

/** Y.Map key under which all blocks for a doc live. */
export const BLOCKS_MAP_KEY = 'pccBlocks'

/** Reserved keys inside an individual block's Y.Map entry. */
export const BLOCK_FIELD_TYPE = 'type'
export const BLOCK_FIELD_PROPS = 'props'
export const BLOCK_FIELD_STATE = 'state'

export type BlockType =
  | 'react'         // sandboxed agent-authored React mini-app (V1 hero)
  | 'chart'         // d3-backed chart with sane defaults
  | 'duckdb'        // WASM SQL over uploaded data (V2)
  | 'scrolly'       // scrollytelling guided explainer (V2)
  | 'pullquote'     // editorial quote block
  | 'callout'       // note/warning/tip aside
  | 'gallery'       // image grid
  | 'hero'          // full-bleed image + headline
  | 'divider'       // typographic divider
  // ... extensible. Keep type as string-ish — the registry decides what's known.

export interface BlockSnapshot {
  /** The anchor that uniquely identifies this block in its doc. */
  anchor: string
  type: string
  props: unknown
  /** Plain-JSON snapshot of the live state Map. */
  state: Record<string, unknown>
}

/** Generates a stable, URL-safe block anchor. */
export function generateAnchor(): string {
  // 9 chars of base36 ≈ 47 bits of entropy. Plenty for in-doc uniqueness.
  // Format: `b-<random>` so anchors are distinguishable from other ID styles
  // when seen in serialized markdown (e.g. `^b-x7k9q2m4a`).
  const r = Math.random().toString(36).slice(2, 11).padEnd(9, '0')
  return `b-${r}`
}

/** True if `s` looks like a paired.cc block anchor (`b-xxxxxxxxx`). */
export function isAnchor(s: string): boolean {
  return /^b-[a-z0-9]{6,}$/i.test(s)
}

/** Read a block's plain snapshot from the blocks Map. Returns null if missing. */
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
    stateMap.forEach((v, k) => { state[k] = v instanceof Object && 'toJSON' in v ? (v as any).toJSON() : v })
  }
  return { anchor, type, props, state }
}

/**
 * Idempotent block upsert. Creates the entry if missing, updates fields
 * supplied in the patch. State merges shallowly into the existing Y.Map.
 * Wraps in a single Yjs transaction so all listeners see one update.
 */
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

/** Removes a block entry. No-op if the anchor doesn't exist. */
export function deleteBlock(doc: Y.Doc, anchor: string): void {
  const blocks = doc.getMap(BLOCKS_MAP_KEY)
  if (blocks.has(anchor)) {
    doc.transact(() => blocks.delete(anchor))
  }
}

/** Iterate all blocks in a doc. Order is insertion order per Y.Map semantics. */
export function listBlocks(doc: Y.Doc): BlockSnapshot[] {
  const blocks = doc.getMap(BLOCKS_MAP_KEY)
  const out: BlockSnapshot[] = []
  blocks.forEach((_, anchor) => {
    const snap = readBlockSnapshot(doc, anchor)
    if (snap) out.push(snap)
  })
  return out
}
