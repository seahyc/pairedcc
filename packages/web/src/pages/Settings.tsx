import { useState, useEffect } from 'react'
import { api } from '../api'

interface ApiKey { id: string; label: string; created_at: string; last_used: string | null }

export function Settings() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [label, setLabel] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)

  const loadKeys = () => api('/api/keys').then(setKeys)
  useEffect(() => { loadKeys() }, [])

  const create = async () => {
    const res = await api('/api/keys', { method: 'POST', body: JSON.stringify({ label: label || 'default' }) })
    setNewKey(res.key)
    setLabel('')
    loadKeys()
  }

  const revoke = async (id: string) => {
    await api(`/api/keys/${id}`, { method: 'DELETE' })
    loadKeys()
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Settings</h1>
        <a href="/" className="btn btn-ghost">&larr; Back</a>
      </header>

      <h2>API Keys</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
        Use these to connect AI agents (Claude Code, Claude Desktop, ChatGPT, etc.)
      </p>

      {newKey && (
        <div className="key-display" style={{ marginBottom: 16 }}>
          <code>{newKey}</code>
          <p style={{ color: '#f0c040', fontSize: 12, marginTop: 8 }}>
            Copy this now -- it won't be shown again.
          </p>
          <pre style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{`// Claude Code settings.json
{
  "mcpServers": {
    "pairedcc": {
      "command": "npx",
      "args": ["@pairedcc/mcp-server"],
      "env": {
        "PAIREDCC_URL": "https://paired.cc",
        "PAIREDCC_API_KEY": "${newKey}"
      }
    }
  }
}`}</pre>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input className="input" value={label} onChange={e => setLabel(e.target.value)}
          placeholder="Label (e.g. claude-code)" style={{ width: 250 }} />
        <button className="btn btn-primary" onClick={create}>Create Key</button>
      </div>

      {keys.map(k => (
        <div key={k.id} className="collab-row">
          <div>
            <strong>{k.label}</strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
              Created {new Date(k.created_at).toLocaleDateString()}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="badge">
              {k.last_used ? `Used ${new Date(k.last_used).toLocaleDateString()}` : 'Never used'}
            </span>
            <button className="btn btn-ghost" style={{ color: '#ff6b6b' }} onClick={() => revoke(k.id)}>
              Revoke
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
