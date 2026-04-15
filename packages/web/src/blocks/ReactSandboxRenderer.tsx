import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { BlockRendererProps } from './registry'
import { BLOCKS_MAP_KEY, BLOCK_FIELD_STATE } from './schema'
import {
  buildSrcdoc,
  isPairedMessage,
  isAllowedFetchUrl,
  type PairedRequest,
  type PairedResponse,
  type PairedEvent,
} from './sandbox'
import { api } from '../api'

/**
 * Renders a `pairedcc:react` block in a sandboxed iframe. Agents author the
 * body HTML/JS in `props.html`. Iframe runs in opaque origin, talks to parent
 * only via postMessage. All state mutations flow through the parent so they
 * become CRDT-merged Yjs edits visible to every other viewer and any agent.
 *
 * Capabilities exposed inside the iframe as `window.paired`:
 *   paired.state.get(key?)      → returns a value, or whole state if no key
 *   paired.state.set(patch)     → shallow-merges patch into the block's state
 *   paired.state.subscribe(fn)  → called with every state update
 *   paired.fetch(url, init)     → proxied through allowlist, returns {status, body}
 *   paired.db(connectorId, q)   → runs SQL via an approved connector, returns rows
 *   paired.user()               → { signedIn, name } — no tokens exposed
 */
export function ReactSandboxRenderer({ doc, anchor, props, state }: BlockRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const html = typeof (props as { html?: unknown })?.html === 'string'
    ? (props as { html: string }).html
    : '<p><em>No html configured for this block. Agent should set props.html.</em></p>'

  // Handle messages from the iframe.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return
      if (!isPairedMessage(ev.data)) return
      const msg = ev.data as PairedRequest | PairedResponse | PairedEvent
      if ('method' in msg) handleRequest(msg, doc, anchor, iframeRef.current)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [doc, anchor])

  // Subscribe to state changes and push them into the iframe so
  // `paired.state.subscribe` callbacks fire for agent-driven updates.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const blocks = doc.getMap(BLOCKS_MAP_KEY)
    const entry = blocks.get(anchor) as Y.Map<unknown> | undefined
    if (!entry) return
    const stateMap = entry.get(BLOCK_FIELD_STATE) as Y.Map<unknown> | undefined
    if (!stateMap) return
    const push = () => {
      const snapshot: Record<string, unknown> = {}
      stateMap.forEach((v, k) => { snapshot[k] = v })
      const payload: PairedEvent = { pairedcc: 1, event: 'state-change', state: snapshot }
      iframe.contentWindow?.postMessage(payload, '*')
    }
    const observer = () => queueMicrotask(push)
    stateMap.observe(observer)
    // Also push on mount/reload so the iframe gets current state without waiting for an edit.
    push()
    return () => stateMap.unobserve(observer)
  }, [doc, anchor, reloadKey])

  return (
    <div className="pcc-renderer pcc-renderer--react">
      <div className="pcc-renderer-label">
        react <code>{anchor}</code>
        <button
          className="pcc-action"
          onClick={() => setReloadKey(k => k + 1)}
          title="Reload the iframe"
        >
          ↻
        </button>
      </div>
      <iframe
        key={reloadKey}
        ref={iframeRef}
        className="pcc-sandbox-iframe"
        sandbox="allow-scripts"
        srcDoc={buildSrcdoc(html)}
      />
      {/* Snapshot visible as accessible fallback + dev context */}
      <details className="pcc-sandbox-state">
        <summary>live state ({Object.keys(state).length} keys)</summary>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </details>
    </div>
  )
}

async function handleRequest(
  req: PairedRequest,
  doc: Y.Doc,
  anchor: string,
  iframe: HTMLIFrameElement | null,
): Promise<void> {
  const reply = (ok: boolean, result?: unknown, error?: string) => {
    const resp: PairedResponse = { pairedcc: 1, id: req.id, ok, result, error }
    iframe?.contentWindow?.postMessage(resp, '*')
  }

  try {
    switch (req.method) {
      case 'ready':
        return reply(true)

      case 'state.get': {
        const blocks = doc.getMap(BLOCKS_MAP_KEY)
        const entry = blocks.get(anchor) as Y.Map<unknown> | undefined
        const stateMap = entry?.get(BLOCK_FIELD_STATE) as Y.Map<unknown> | undefined
        const key = req.args?.[0] as string | undefined
        if (key !== undefined) return reply(true, stateMap?.get(key))
        const snap: Record<string, unknown> = {}
        stateMap?.forEach((v, k) => { snap[k] = v })
        return reply(true, snap)
      }

      case 'state.set': {
        const patch = (req.args?.[0] ?? {}) as Record<string, unknown>
        if (!patch || typeof patch !== 'object') {
          return reply(false, undefined, 'state.set requires an object patch')
        }
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
        return reply(true)
      }

      case 'fetch': {
        const [url, init] = req.args as [string, RequestInit | undefined]
        if (typeof url !== 'string' || !isAllowedFetchUrl(url)) {
          return reply(false, undefined, 'URL not allowed. Request the host be added to FETCH_ALLOWLIST.')
        }
        // Only GET + HEAD in V1. No auth headers passed through.
        const method = init?.method?.toUpperCase() || 'GET'
        if (method !== 'GET' && method !== 'HEAD') {
          return reply(false, undefined, 'Only GET and HEAD are allowed in V1.')
        }
        const res = await fetch(url, { method })
        const body = await res.text()
        return reply(true, { status: res.status, body })
      }

      case 'db': {
        const [connectorId, query, params] = req.args as [string, string, unknown[]]
        if (typeof connectorId !== 'string' || typeof query !== 'string') {
          return reply(false, undefined, 'db(connectorId, query, params?) — args mismatch')
        }
        const docId = window.location.pathname.split('/d/')[1]?.split('/')[0]
        if (!docId) return reply(false, undefined, 'No docId in URL')
        try {
          const rows = await api(`/api/documents/${docId}/db/${connectorId}/query`, {
            method: 'POST',
            body: JSON.stringify({ query, params: params || [] }),
          })
          return reply(true, rows)
        } catch (e) {
          return reply(false, undefined, (e as Error).message)
        }
      }

      case 'user': {
        // Read the parent's session via the existing /auth/me endpoint.
        try {
          const u = await api('/auth/me')
          return reply(true, { signedIn: true, name: u.name || u.email })
        } catch {
          return reply(true, { signedIn: false })
        }
      }

      default:
        return reply(false, undefined, `Unknown method: ${(req as PairedRequest).method}`)
    }
  } catch (e) {
    reply(false, undefined, (e as Error).message)
  }
}
