import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useDocument } from '../hooks/useDocument'
import { usePresence } from '../hooks/usePresence'
import { useAuth } from '../hooks/useAuth'
import { TiptapEditor } from '../components/editor/TiptapEditor'
import { TopBar } from '../components/TopBar'
import { ShareDialog } from '../components/ShareDialog'
import { VersionHistory } from '../components/VersionHistory'
import { Toast } from '../components/Toast'
import { DocsSidebar } from '../components/DocsSidebar'

// Tracks doc IDs we've already shown the first-creation toast for in this tab.
// Module-level so React Strict Mode's dev-only double-mount can't re-trigger it.
const toastShownFor = new Set<string>()

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
  const { doc, provider, meta, connected, claimDoc } = useDocument(docId!)
  const peers = usePresence(provider)
  const [shareOpen, setShareOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Show a one-time "your doc is at..." toast when arriving from creation.
  // The flag is set by HomepageRedirect / Landing / Dashboard before navigating.
  // We use a module-level Set (toastShownFor) to survive React Strict Mode's
  // double-mount in dev — without it, the first mount clears sessionStorage and
  // the second mount finds nothing, so the toast never sticks.
  useEffect(() => {
    if (!docId) return
    const justCreated = sessionStorage.getItem('pairedcc:just-created')
    if (justCreated === docId && !toastShownFor.has(docId)) {
      toastShownFor.add(docId)
      sessionStorage.removeItem('pairedcc:just-created')
      const url = `${window.location.origin}/d/${docId}`
      setToast(`Your doc is at ${url} — anyone with this link can edit.`)
    }
  }, [docId])

  if (!provider || !meta) return <div className="loading">Loading document...</div>

  const handleClaim = async () => {
    setClaiming(true)
    try { await claimDoc() } finally { setClaiming(false) }
  }

  return (
    <div className="editor-page">
      {meta.is_anonymous && meta.expires_at && (
        <div className="anon-banner">
          <strong>Public sandbox doc</strong> — anyone with this link can edit. Expires in {timeUntilExpiry(meta.expires_at)}.{' '}
          {user ? (
            <button className="banner-action" onClick={handleClaim} disabled={claiming}>
              {claiming ? 'Saving…' : 'Save to your account'}
            </button>
          ) : (
            <a href={`/login?returnTo=/d/${docId}`}>Sign in</a>
          )}
          {' '}to keep it.
        </div>
      )}
      <TopBar
        title={meta.title}
        onTitleChange={() => {}}
        peers={peers}
        onShare={() => setShareOpen(true)}
        onVersionHistory={user ? () => setHistoryOpen(true) : undefined}
        onOpenSidebar={user ? () => setSidebarOpen(true) : undefined}
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
      <DocsSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} currentDocId={docId} />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
