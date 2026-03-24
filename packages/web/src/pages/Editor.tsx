import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useDocument } from '../hooks/useDocument'
import { usePresence } from '../hooks/usePresence'
import { useAuth } from '../hooks/useAuth'
import { TiptapEditor } from '../components/editor/TiptapEditor'
import { TopBar } from '../components/TopBar'
import { ShareDialog } from '../components/ShareDialog'
import { VersionHistory } from '../components/VersionHistory'

function timeUntilExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function Editor() {
  const { docId } = useParams<{ docId: string }>()
  const { user } = useAuth()
  const { doc, provider, meta, connected } = useDocument(docId!)
  const peers = usePresence(provider)
  const [shareOpen, setShareOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  if (!provider || !meta) return <div className="loading">Loading document...</div>

  return (
    <div className="editor-page">
      {meta.is_anonymous && meta.expires_at && (
        <div className="anon-banner">
          This doc expires in {timeUntilExpiry(meta.expires_at)}.{' '}
          <a href="/login">Sign up</a> to keep it.
        </div>
      )}
      <TopBar
        title={meta.title}
        onTitleChange={() => {}}
        peers={peers}
        onShare={() => setShareOpen(true)}
        onVersionHistory={user ? () => setHistoryOpen(true) : undefined}
      />
      {!connected && <div className="connection-bar">Reconnecting...</div>}
      <div className="editor-container">
        <TiptapEditor
          doc={doc}
          provider={provider}
          userName={user?.name || user?.email || 'Anonymous'}
          userColor="#4a9eff"
          isAnonymous={meta.is_anonymous}
        />
      </div>
      <ShareDialog docId={docId!} open={shareOpen} onClose={() => setShareOpen(false)} />
      <VersionHistory docId={docId!} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  )
}
