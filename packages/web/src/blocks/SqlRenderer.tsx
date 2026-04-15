import { useEffect, useState } from 'react'
import type { BlockRendererProps } from './registry'
import { TableRenderer } from './TableRenderer'
import { api } from '../api'

/**
 * `pairedcc:sql` — one-shot SQL query rendered as a table. Uses the same
 * connector layer as `paired.db()` from React blocks, but as a zero-code
 * primitive: agent sets `props.connectorId` + `props.query`, we render.
 *
 * Always read-only. Results are polled on mount + when props change.
 * For interactive query editing, use `pairedcc:react` + paired.db().
 *
 * props: { connectorId: string, query: string, title?: string }
 */
export function SqlRenderer({ doc: _doc, anchor, props, state, type }: BlockRendererProps) {
  const p = (props && typeof props === 'object' ? props : {}) as {
    connectorId?: string
    query?: string
    title?: string
  }
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!p.connectorId || !p.query) return
    const docId = window.location.pathname.split('/d/')[1]?.split('/')[0]
    if (!docId) { setError('No docId in URL'); return }
    setLoading(true); setError(null)
    api(`/api/documents/${docId}/db/${p.connectorId}/query`, {
      method: 'POST',
      body: JSON.stringify({ query: p.query }),
    }).then((res) => {
      setRows(Array.isArray(res.rows) ? res.rows : [])
    }).catch((e) => {
      setError((e as Error).message || 'Query failed')
    }).finally(() => setLoading(false))
  }, [p.connectorId, p.query])

  if (!p.connectorId || !p.query) {
    return (
      <div className="pcc-renderer pcc-renderer--sql">
        <div className="pcc-renderer-label">sql</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Set <code>props.connectorId</code> and <code>props.query</code>.
        </p>
      </div>
    )
  }
  if (loading) {
    return <div className="pcc-renderer pcc-renderer--sql"><div className="pcc-renderer-label">sql · running…</div></div>
  }
  if (error) {
    return (
      <div className="pcc-renderer pcc-renderer--sql">
        <div className="pcc-renderer-label">sql · error</div>
        <pre style={{ color: '#ff6b6b', fontSize: 12 }}>{error}</pre>
        <details style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          <summary>query</summary>
          <pre>{p.query}</pre>
        </details>
      </div>
    )
  }
  return (
    <div className="pcc-renderer pcc-renderer--sql">
      {p.title && <h4 style={{ margin: '4px 0 8px', fontSize: 15 }}>{p.title}</h4>}
      <TableRenderer
        doc={_doc}
        anchor={anchor}
        type={type}
        props={{ data: rows || [] }}
        state={state}
      />
    </div>
  )
}
