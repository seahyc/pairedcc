import { useState, useEffect } from 'react'
import { api } from '../api'

interface Props {
  docId: string
  open: boolean
  onClose: () => void
}

export function ShareDialog({ docId, open, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [collabs, setCollabs] = useState<any[]>([])
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    api(`/api/documents/${docId}/collaborators`).then(setCollabs)
    api('/api/keys').then(setApiKeys)
  }, [open, docId])

  const invite = async () => {
    await api(`/api/documents/${docId}/collaborators`, {
      method: 'POST', body: JSON.stringify({ email }),
    })
    setEmail('')
    api(`/api/documents/${docId}/collaborators`).then(setCollabs)
  }

  const createKey = async () => {
    const res = await api('/api/keys', {
      method: 'POST', body: JSON.stringify({ label: 'agent' }),
    })
    setNewKey(res.key)
    api('/api/keys').then(setApiKeys)
  }

  if (!open) return null

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>Share Document</h3>

        <div className="share-section">
          <h4>Invite people</h4>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com" />
            <button className="btn btn-primary" onClick={invite}>Invite</button>
          </div>
          {collabs.map(c => (
            <div key={c.id} className="collab-row">
              <span>{c.name || c.email}</span>
              <span className="badge">{c.role}</span>
            </div>
          ))}
        </div>

        <div className="share-section">
          <h4>Agent API Key</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Connect Claude Code, Claude Desktop, or any MCP client.
          </p>
          {newKey && (
            <div className="key-display">
              <code>{newKey}</code>
              <p style={{ color: '#f0c040', fontSize: 12 }}>Copy this now -- it won't be shown again.</p>
            </div>
          )}
          <button className="btn" onClick={createKey}>Generate new key</button>
          {apiKeys.map(k => (
            <div key={k.id} className="collab-row">
              <span>{k.label}</span>
              <span className="badge">{k.last_used ? `Used ${new Date(k.last_used).toLocaleDateString()}` : 'Never used'}</span>
            </div>
          ))}
        </div>

        <button className="btn btn-ghost" onClick={onClose} style={{ marginTop: 16 }}>Close</button>
      </div>
    </div>
  )
}
