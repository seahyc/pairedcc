import { useState, useEffect } from 'react'
import { api } from '../api'

interface Snapshot {
  id: string
  authorId: string
  authorType: 'human' | 'agent'
  description: string | null
  createdAt: string
}

interface Props {
  docId: string
  open: boolean
  onClose: () => void
}

export function VersionHistory({ docId, open, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])

  useEffect(() => {
    if (!open) return
    api(`/api/documents/${docId}/snapshots`).then(setSnapshots)
  }, [open, docId])

  const restore = async (snapshotId: string) => {
    await api(`/api/documents/${docId}/snapshots/${snapshotId}/restore`, { method: 'POST' })
    onClose()
  }

  if (!open) return null

  return (
    <div className="version-sidebar">
      <div className="version-header">
        <h3>Version History</h3>
        <button className="btn btn-ghost" onClick={onClose}>&times;</button>
      </div>
      <div className="version-list">
        {snapshots.map(s => (
          <div key={s.id} className="version-item">
            <div className="version-meta">
              <span className={`version-author ${s.authorType}`}>
                {s.authorType === 'agent' ? '\u{1F916}' : '\u{1F464}'} {s.authorId}
              </span>
              <time>{new Date(s.createdAt).toLocaleString()}</time>
            </div>
            {s.description && <p className="version-desc">{s.description}</p>}
            <button className="btn btn-ghost" onClick={() => restore(s.id)}>Restore</button>
          </div>
        ))}
        {snapshots.length === 0 && <p className="empty">No snapshots yet.</p>}
      </div>
    </div>
  )
}
