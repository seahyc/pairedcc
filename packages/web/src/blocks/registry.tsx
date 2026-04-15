import type { ComponentType } from 'react'
import type * as Y from 'yjs'

/**
 * Renderer registry — maps a block `type` to a React component that knows
 * how to render it. The renderer receives the block's anchor, the live
 * Y.Doc (so it can subscribe to its state Map for CRDT-live updates), and
 * the snapshot props.
 *
 * Renderers can re-render on every state change by subscribing to the
 * block's state Y.Map directly. The base ComponentBlockNode provides a
 * `useBlockState` helper for this.
 */

export interface BlockRendererProps {
  doc: Y.Doc
  anchor: string
  type: string
  props: unknown
  /** A read-only snapshot of state at render time. Use `useBlockState` for live updates. */
  state: Record<string, unknown>
}

export type BlockRenderer = ComponentType<BlockRendererProps>

const renderers = new Map<string, BlockRenderer>()
let fallbackRenderer: BlockRenderer | null = null

export function registerRenderer(type: string, renderer: BlockRenderer): void {
  renderers.set(type, renderer)
}

export function setFallbackRenderer(renderer: BlockRenderer): void {
  fallbackRenderer = renderer
}

export function getRenderer(type: string): BlockRenderer | null {
  return renderers.get(type) ?? fallbackRenderer
}

/** For the agent SDK / block-kit manifest endpoint — names the type registry. */
export function listRegisteredTypes(): string[] {
  return Array.from(renderers.keys()).sort()
}
