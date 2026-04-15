import { useEffect, useState } from 'react'
import { api } from '../api'

interface Connector {
  id: string
  name: string
  kind: string
  scope: 'read' | 'write'
  created_at: string
  last_used: string | null
}

/**
 * Settings panel for managing Postgres connectors. Credentials are sent
 * once at create time, encrypted server-side, and never displayed back.
 * Deletion is a hard delete (cascades to all doc grants).
 */
export function ConnectorsPanel() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('read')

  const load = () => api('/api/connectors').then(setConnectors).catch(() => setConnectors([]))
  useEffect(() => { load() }, [])

  const create = async () => {
    setError(null)
    if (!name.trim()) return setError('Name is required.')
    if (!url.trim()) return setError('Connection string is required.')
    setBusy(true)
    try {
      await api('/api/connectors', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), kind: 'postgres', scope, creds: { url: url.trim() } }),
      })
      setName(''); setUrl(''); setScope('read'); setShowForm(false)
      load()
    } catch (e) {
      setError((e as Error).message || 'Could not create connector.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Delete this connector? It will be removed from any docs that use it.')) return
    await api(`/api/connectors/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <section>
      <h2>Data Connectors</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 13 }}>
        Connect a Postgres database so live query blocks can read from it. Credentials are encrypted
        at rest and never shown in docs. Each doc must explicitly grant a connector before it can
        run queries — public and anonymous docs cannot use connectors at all.
      </p>

      {!showForm && (
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          Add Postgres connector
        </button>
      )}

      {showForm && (
        <div className="connector-form">
          <label className="connector-field">
            <span>Name</span>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="prod-readonly"
            />
          </label>
          <label className="connector-field">
            <span>Connection string</span>
            <input
              className="input"
              type="password"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="postgres://user:pass@host:5432/db"
              autoComplete="off"
            />
            <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              Encrypted with AES-256-GCM. Prefer a read-only database user.
            </small>
          </label>
          <label className="connector-field">
            <span>Access</span>
            <select
              className="input"
              value={scope}
              onChange={e => setScope(e.target.value as 'read' | 'write')}
            >
              <option value="read">Read only (SELECT)</option>
              <option value="write">Read + write</option>
            </select>
          </label>
          {error && <p style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={create} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setError(null) }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {connectors.length === 0 && !showForm && (
        <p style={{ color: 'var(--text-muted)', marginTop: 16, fontSize: 13 }}>
          No connectors yet.
        </p>
      )}

      {connectors.map(c => (
        <div key={c.id} className="collab-row">
          <div>
            <strong>{c.name}</strong>
            <span className="badge" style={{ marginLeft: 8 }}>{c.kind}</span>
            <span className="badge" style={{ marginLeft: 4 }}>{c.scope}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {c.last_used ? `Last used ${new Date(c.last_used).toLocaleDateString()}` : 'Never used'}
            </span>
            <button className="btn btn-ghost" style={{ color: '#ff6b6b' }} onClick={() => remove(c.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
