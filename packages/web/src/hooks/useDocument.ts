import { useState, useEffect } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { api } from '../api'

interface DocMeta { id: string; title: string; is_anonymous?: boolean; expires_at?: string }

export function useDocument(docId: string) {
  const [doc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [meta, setMeta] = useState<DocMeta | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    api(`/api/documents/${docId}`).then(setMeta).catch(() => {})

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/${docId}`
    const prov = new WebsocketProvider(wsUrl, docId, doc)
    prov.on('status', ({ status }: { status: string }) => setConnected(status === 'connected'))
    setProvider(prov)

    return () => { prov.destroy(); doc.destroy() }
  }, [docId])

  return { doc, provider, meta, connected }
}
