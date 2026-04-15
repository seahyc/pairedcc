import { useState } from 'react'
import * as Y from 'yjs'
import { registerRenderer, setFallbackRenderer, type BlockRendererProps } from './registry'
import { BLOCKS_MAP_KEY, BLOCK_FIELD_STATE } from './schema'
import { ReactSandboxRenderer } from './ReactSandboxRenderer'

/**
 * React hook to mutate a block's live CRDT state. Returns a setter that
 * shallow-merges the patch into the block's state Y.Map.
 */
function useBlockStateSetter(doc: Y.Doc, anchor: string) {
  return (patch: Record<string, unknown>) => {
    doc.transact(() => {
      const blocks = doc.getMap(BLOCKS_MAP_KEY)
      const entry = blocks.get(anchor) as Y.Map<unknown> | undefined
      if (!entry) return
      let stateMap = entry.get(BLOCK_FIELD_STATE) as Y.Map<unknown> | undefined
      if (!stateMap) {
        stateMap = new Y.Map()
        entry.set(BLOCK_FIELD_STATE, stateMap)
      }
      for (const [k, v] of Object.entries(patch)) stateMap.set(k, v)
    })
  }
}

/**
 * Stub `pairedcc:counter` renderer — proves the substrate end-to-end.
 * Click increments. State is CRDT-shared, so multiple viewers click
 * the same counter live.
 */
function CounterRenderer({ doc, anchor, state }: BlockRendererProps) {
  const setState = useBlockStateSetter(doc, anchor)
  const count = typeof state.count === 'number' ? state.count : 0
  return (
    <div className="pcc-renderer pcc-renderer--counter">
      <div className="pcc-renderer-label">counter <code>{anchor}</code></div>
      <button
        className="pcc-counter-btn"
        onClick={() => setState({ count: count + 1 })}
      >
        {count}
      </button>
      <small style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
        clicks merge across all viewers via Yjs
      </small>
    </div>
  )
}

/** Pull-quote — read-only, props.text + props.attribution. */
function PullquoteRenderer({ props }: BlockRendererProps) {
  const p = (props && typeof props === 'object' ? props : {}) as { text?: string; attribution?: string }
  return (
    <blockquote className="pcc-renderer pcc-renderer--pullquote">
      <p>{p.text || '(empty pullquote)'}</p>
      {p.attribution && <cite>— {p.attribution}</cite>}
    </blockquote>
  )
}

/** Callout — props.kind ('note'|'warn'|'tip'), props.body. */
function CalloutRenderer({ props }: BlockRendererProps) {
  const p = (props && typeof props === 'object' ? props : {}) as { kind?: string; body?: string }
  const kind = p.kind || 'note'
  return (
    <aside className={`pcc-renderer pcc-renderer--callout pcc-callout--${kind}`}>
      <strong>{kind.toUpperCase()}</strong>
      <p>{p.body || ''}</p>
    </aside>
  )
}

/** Fallback — shown for any unregistered type. */
function UnknownRenderer({ type, props, state, anchor }: BlockRendererProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pcc-renderer pcc-renderer--unknown">
      <div>
        <strong>Block:</strong> <code>{type}</code>{' '}
        <code style={{ opacity: 0.6 }}>{anchor}</code>{' '}
        <button onClick={() => setOpen(o => !o)} style={{ fontSize: 11 }}>
          {open ? 'hide' : 'show'} payload
        </button>
      </div>
      {open && (
        <pre style={{ fontSize: 11, marginTop: 8, opacity: 0.8 }}>
          {JSON.stringify({ props, state }, null, 2)}
        </pre>
      )}
    </div>
  )
}

let registered = false
export function registerBuiltinRenderers() {
  if (registered) return
  registered = true
  registerRenderer('counter', CounterRenderer)
  registerRenderer('pullquote', PullquoteRenderer)
  registerRenderer('callout', CalloutRenderer)
  registerRenderer('react', ReactSandboxRenderer)
  setFallbackRenderer(UnknownRenderer)
}

// Surface useBlockStateSetter for renderers in other files.
export { useBlockStateSetter }
