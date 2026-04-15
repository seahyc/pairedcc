import { useState, useEffect } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { api } from '../api'

interface DocMeta {
  id: string
  title: string
  is_anonymous?: boolean
  is_public?: boolean
  expires_at?: string
  owner_id?: string
}

export function useDocument(docId: string) {
  const [doc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [meta, setMeta] = useState<DocMeta | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // Anonymous docs are publicly editable by anyone with the link.
    // We DON'T auto-claim — that would let any signed-in visitor accidentally
    // take ownership of someone else's sandbox doc. Claim is opt-in via the
    // "Save to your account" action in the banner.
    api(`/api/documents/${docId}`).then(setMeta).catch(() => {})

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    const prov = new WebsocketProvider(wsUrl, docId, doc)
    prov.on('status', ({ status }: { status: string }) => setConnected(status === 'connected'))
    setProvider(prov)

    return () => { prov.destroy(); doc.destroy() }
  }, [docId])

  const claimDoc = async () => {
    const claimed = await api(`/api/documents/${docId}/claim`, { method: 'POST' })
    setMeta(claimed)
    return claimed
  }

  return { doc, provider, meta, connected, claimDoc }
}
