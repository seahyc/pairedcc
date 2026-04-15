import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'

interface Doc {
  id: string
  title: string
  updated_at: string
  is_anonymous?: boolean
  is_public?: boolean
  archived?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  /** Doc currently open in the editor — highlighted in the list. */
  currentDocId?: string
}

export function DocsSidebar({ open, onClose, currentDocId }: Props) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await api(`/api/documents${showArchived ? '?include_archived=true' : ''}`)
      setDocs(Array.isArray(list) ? list : [])
    } catch {
      setDocs([])
    } finally {
      setLoading(false)
    }
  }

  // Refetch when sidebar opens or archived filter flips.
  useEffect(() => {
    if (open) refresh()
  }, [open, showArchived])

  // Esc closes; '/' focuses search when sidebar is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Auto-focus search when opening.
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter(d => (d.title || 'Untitled').toLowerCase().includes(q))
  }, [docs, query])

  const startRename = (doc: Doc) => {
    setEditingId(doc.id)
    setEditTitle(doc.title || 'Untitled')
  }

  const commitRename = async (doc: Doc) => {
    const next = editTitle.trim() || 'Untitled'
    setEditingId(null)
    if (next === doc.title) return
    try {
      const updated = await api(`/api/documents/${doc.id}`, {
        method: 'PATCH', body: JSON.stringify({ title: next }),
      })
      setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, title: updated.title } : d))
    } catch {}
  }

  const setArchived = async (doc: Doc, archived: boolean) => {
    try {
      await api(`/api/documents/${doc.id}`, {
        method: 'PATCH', body: JSON.stringify({ archived }),
      })
      // Optimistic: drop from current list if filter excludes it.
      if (showArchived) {
        setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, archived } : d))
      } else {
        setDocs(prev => prev.filter(d => d.id !== doc.id || archived === false))
        if (!archived) refresh()
      }
    } catch {}
  }

  if (!open) return null

  return (
    <>
      <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="docs-sidebar" role="dialog" aria-label="My documents">
        <header className="docs-sidebar-header">
          <h2>My docs</h2>
          <button className="docs-sidebar-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="docs-sidebar-controls">
          <input
            ref={searchRef}
            className="input"
            placeholder="Search docs… (press / to focus)"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <label className="docs-sidebar-archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
            />
            <span>Show archived</span>
          </label>
        </div>

        <div className="docs-sidebar-list">
          {loading && <p className="docs-sidebar-empty">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="docs-sidebar-empty">
              {query ? 'No docs match.' : showArchived ? 'No archived docs.' : 'No docs yet.'}
            </p>
          )}
          {filtered.map(doc => {
            const isCurrent = doc.id === currentDocId
            const isEditing = editingId === doc.id
            return (
              <div key={doc.id} className={`docs-sidebar-row ${isCurrent ? 'is-current' : ''} ${doc.archived ? 'is-archived' : ''}`}>
                {isEditing ? (
                  <input
                    className="input docs-sidebar-rename"
                    autoFocus
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={() => commitRename(doc)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <a className="docs-sidebar-link" href={`/d/${doc.id}`}>
                    <span className="docs-sidebar-title">{doc.title || 'Untitled'}</span>
                    <time className="docs-sidebar-time">{relTime(doc.updated_at)}</time>
                  </a>
                )}
                <div className="docs-sidebar-actions">
                  {!isEditing && (
                    <button
                      className="docs-sidebar-action"
                      title="Rename"
                      onClick={() => startRename(doc)}
                    >
                      Rename
                    </button>
                  )}
                  {!isEditing && (
                    <button
                      className="docs-sidebar-action"
                      title={doc.archived ? 'Restore' : 'Archive'}
                      onClick={() => setArchived(doc, !doc.archived)}
                    >
                      {doc.archived ? 'Restore' : 'Archive'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
