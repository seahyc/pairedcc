import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

interface Doc { id: string; title: string; updated_at: string }

export function Dashboard() {
  const [docs, setDocs] = useState<Doc[]>([])
  const navigate = useNavigate()

  useEffect(() => { api('/api/documents').then(setDocs) }, [])

  const createDoc = async () => {
    const doc = await api('/api/documents', { method: 'POST', body: JSON.stringify({}) })
    navigate(`/d/${doc.id}`)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>paired.cc</h1>
        <div>
          <button onClick={createDoc} className="btn btn-primary">New Document</button>
          <a href="/settings" className="btn btn-ghost">Settings</a>
        </div>
      </header>
      <div className="doc-list">
        {docs.map(doc => (
          <a key={doc.id} href={`/d/${doc.id}`} className="doc-card">
            <h3>{doc.title}</h3>
            <time>{new Date(doc.updated_at).toLocaleDateString()}</time>
          </a>
        ))}
        {docs.length === 0 && <p className="empty">No documents yet. Create one to get started.</p>}
      </div>
    </div>
  )
}
