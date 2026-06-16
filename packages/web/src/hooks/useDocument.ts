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
  // `connected` tracks the true socket state. `showReconnecting` is the
  // debounced, UI-facing signal: it only turns true after the socket has been
  // down past a short grace window, so a momentary reconnect blip (or the
  // initial connect handshake) never flashes the "Reconnecting…" banner.
  const [connected, setConnected] = useState(false)
  const [showReconnecting, setShowReconnecting] = useState(false)

  useEffect(() => {
    // Anonymous docs are publicly editable by anyone with the link.
    // We DON'T auto-claim — that would let any signed-in visitor accidentally
    // take ownership of someone else's sandbox doc. Claim is opt-in via the
    // "Save to your account" action in the banner.
    api(`/api/documents/${docId}`).then(setMeta).catch(() => {})

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    const prov = new WebsocketProvider(wsUrl, docId, doc)
    // y-websocket can fire 'status' synchronously in the same call stack as
    // child renders that touch the provider (e.g. Tiptap's collab extension
    // wiring). Defer the setState to avoid mid-render parent updates.
    prov.on('status', ({ status }: { status: string }) => {
      queueMicrotask(() => setConnected(status === 'connected'))
    })
    setProvider(prov)

    return () => { prov.destroy(); doc.destroy() }
  }, [docId])

  // Debounce the banner. Show "Reconnecting…" only if we've been disconnected
  // for longer than the grace window; hide it immediately on reconnect. This
  // smooths the brief connecting→connected handshake and any transient blip,
  // so the banner reflects a real outage rather than normal socket churn.
  useEffect(() => {
    if (connected) {
      setShowReconnecting(false)
      return
    }
    const t = setTimeout(() => setShowReconnecting(true), 3000)
    return () => clearTimeout(t)
  }, [connected])

  const claimDoc = async () => {
    const claimed = await api(`/api/documents/${docId}/claim`, { method: 'POST' })
    setMeta(claimed)
    return claimed
  }

  return { doc, provider, meta, connected, showReconnecting, claimDoc }
}
