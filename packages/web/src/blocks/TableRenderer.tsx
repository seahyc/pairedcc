import { useMemo, useState } from 'react'
import type { BlockRendererProps } from './registry'

/**
 * `pairedcc:table` — sortable, filterable data table with good defaults.
 *
 * props shape:
 *   {
 *     columns?: Array<string | { key, label?, align?, format? }>,
 *     data: Array<Record<string, unknown>>,
 *     pageSize?: number,    // default 25
 *     searchable?: boolean, // default true
 *   }
 *
 * If columns isn't supplied, derives from the first row. Supports click-to-sort,
 * live text filter across all cells, pagination. Numeric columns right-align
 * automatically.
 */
export function TableRenderer({ props }: BlockRendererProps) {
  const p = (props && typeof props === 'object' ? props : {}) as {
    columns?: Array<string | { key: string; label?: string; align?: 'left' | 'right'; format?: 'num' | 'date' }>
    data?: Array<Record<string, unknown>>
    pageSize?: number
    searchable?: boolean
  }
  const data = Array.isArray(p.data) ? p.data : []
  const pageSize = p.pageSize ?? 25
  const searchable = p.searchable ?? true

  const columns = useMemo(() => {
    if (p.columns && p.columns.length > 0) {
      return p.columns.map(c => typeof c === 'string' ? { key: c, label: c } : { label: c.key, ...c })
    }
    const first = data[0]
    if (!first) return []
    return Object.keys(first).map(k => ({ key: k, label: k }))
  }, [p.columns, data])

  // Auto-detect numeric columns for right-align
  const columnIsNumeric = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const col of columns) {
      const samples = data.slice(0, 10).map(r => r[col.key]).filter(v => v != null)
      m[col.key] = samples.length > 0 && samples.every(v => typeof v === 'number' || !Number.isNaN(Number(v)))
    }
    return m
  }, [columns, data])

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    if (!query.trim()) return data
    const q = query.trim().toLowerCase()
    return data.filter(row =>
      Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q))
    )
  }, [data, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const dir = sortDir === 'asc' ? 1 : -1
    const isNum = columnIsNumeric[sortKey]
    return [...filtered].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (isNum) return (Number(av ?? 0) - Number(bv ?? 0)) * dir
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir
    })
  }, [filtered, sortKey, sortDir, columnIsNumeric])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize)

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
    setPage(0)
  }

  if (columns.length === 0) {
    return (
      <div className="pcc-renderer pcc-renderer--table">
        <div className="pcc-renderer-label">table</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No data. Set <code>props.data</code> to an array of objects.
        </p>
      </div>
    )
  }

  return (
    <div className="pcc-renderer pcc-renderer--table">
      <div className="pcc-renderer-label">
        table · {sorted.length} row{sorted.length === 1 ? '' : 's'}
      </div>
      {searchable && (
        <input
          className="input pcc-table-search"
          placeholder="Filter…"
          value={query}
          onChange={e => { setQuery(e.target.value); setPage(0) }}
        />
      )}
      <div className="pcc-table-wrap">
        <table className="pcc-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  style={{ textAlign: col.align || (columnIsNumeric[col.key] ? 'right' : 'left') }}
                >
                  {col.label || col.key}
                  {sortKey === col.key && <span className="pcc-table-sort">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i}>
                {columns.map(col => {
                  const v = row[col.key]
                  return (
                    <td key={col.key} style={{ textAlign: col.align || (columnIsNumeric[col.key] ? 'right' : 'left') }}>
                      {formatCell(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pcc-table-pagination">
          <button className="btn btn-ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{page + 1} / {totalPages}</span>
          <button className="btn btn-ghost" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>›</button>
        </div>
      )}
    </div>
  )
}

function formatCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString()
    return v.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  if (v instanceof Date) return v.toLocaleDateString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
