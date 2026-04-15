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
  const [meta, setMeta] = useState<{ is_public?: boolean; is_anonymous?: boolean; owner_id?: string | null } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [agentsOpen, setAgentsOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    api(`/api/documents/${docId}`).then(setMeta).catch(() => {})
    api(`/api/documents/${docId}/share`).then(setCollabs).catch(() => setCollabs([]))
    api('/api/keys').then(setApiKeys).catch(() => setApiKeys([]))
  }, [open, docId])

  const invite = async () => {
    await api(`/api/documents/${docId}/share`, {
      method: 'POST', body: JSON.stringify({ email }),
    })
    setEmail('')
    api(`/api/documents/${docId}/share`).then(setCollabs)
  }

  const createKey = async () => {
    const res = await api('/api/keys', {
      method: 'POST', body: JSON.stringify({ label: 'agent' }),
    })
    setNewKey(res.key)
    api('/api/keys').then(setApiKeys)
  }

  const togglePublic = async (next: boolean) => {
    const updated = await api(`/api/documents/${docId}/visibility`, {
      method: 'PATCH', body: JSON.stringify({ is_public: next }),
    })
    setMeta(updated)
  }

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    } catch {}
  }

  if (!open) return null

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = `${origin}/d/${docId}`
  const rawUrl = `${origin}/api/documents/${docId}/raw`
  const isAnon = meta?.is_anonymous
  const isPublic = !!meta?.is_public
  const linkActive = isAnon || isPublic
  const canToggle = !isAnon && !!meta?.owner_id

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>Share</h3>

        {/* HERO: copy URL is the primary action */}
        <div className="share-hero">
          <div className="share-link">
            <input className="input" readOnly value={shareUrl} onFocus={e => e.target.select()} />
            <button className="btn btn-primary" onClick={() => copy('share', shareUrl)}>
              {copied === 'share' ? 'Copied!' : 'Copy link'}
            </button>
          </div>
          <p className="share-status">
            {isAnon
              ? 'Anyone with this link can edit. Sandbox doc — save to your account to keep it.'
              : isPublic
                ? 'Anyone with this link can view.'
                : canToggle
                  ? 'Only you and invited people can access. Toggle public link below.'
                  : 'Sign in to share this doc.'}
          </p>
          {canToggle && (
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={e => togglePublic(e.target.checked)}
              />
              <span>Anyone with the link can view</span>
            </label>
          )}
        </div>

        {/* Invite by email — only useful for owned docs */}
        {!isAnon && meta?.owner_id && (
          <div className="share-section">
            <h4>Invite people</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="email@example.com" />
              <button className="btn" onClick={invite}>Invite</button>
            </div>
            {collabs.map(c => (
              <div key={c.id} className="collab-row">
                <span>{c.name || c.email}</span>
                <span className="badge">{c.role}</span>
              </div>
            ))}
          </div>
        )}

        {/* Agent section — collapsed by default */}
        <div className="share-section">
          <button
            className="share-disclosure"
            onClick={() => setAgentsOpen(o => !o)}
            aria-expanded={agentsOpen}
          >
            <span>{agentsOpen ? '▾' : '▸'}</span>
            <span>For agents</span>
            <span className="share-disclosure-hint">curl, WebFetch, MCP, Claude Code</span>
          </button>

          {agentsOpen && (
            <div className="share-agent-panel">
              {linkActive && (
                <>
                  <label className="share-agent-label">Agent-readable URL</label>
                  <div className="share-link">
                    <input className="input" readOnly value={rawUrl} onFocus={e => e.target.select()} />
                    <button className="btn" onClick={() => copy('raw', rawUrl)}>
                      {copied === 'raw' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="share-help">
                    Returns the doc as plain markdown. Works with <code>curl</code>, WebFetch, or any LLM that can pull a URL.
                  </p>
                </>
              )}

              <label className="share-agent-label" style={{ marginTop: 16 }}>API key for write access</label>
              <p className="share-help">
                Connect Claude Code, Claude Desktop, or any MCP client.
              </p>
              {newKey && (
                <div className="key-display">
                  <code>{newKey}</code>
                  <p style={{ color: '#f0c040', fontSize: 12 }}>Copy this now — it won't be shown again.</p>
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
          )}
        </div>

        <button className="btn btn-ghost" onClick={onClose} style={{ marginTop: 16 }}>Close</button>
      </div>
    </div>
  )
}
