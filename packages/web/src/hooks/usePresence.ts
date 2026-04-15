import { useState, useEffect } from 'react'
import type { WebsocketProvider } from 'y-websocket'

interface Peer { name: string; color: string; isAgent?: boolean }

export function usePresence(provider: WebsocketProvider | null) {
  const [peers, setPeers] = useState<Peer[]>([])

  useEffect(() => {
    if (!provider) return
    const awareness = provider.awareness
    // Tiptap's CollaborationCursor extension calls awareness.setLocalStateField
    // synchronously during the editor's `useEditor` initialization. That fires
    // a 'change' event in the same call stack as TiptapEditor's render — if we
    // setState directly here, React warns about updating Editor (parent) while
    // TiptapEditor (child) is rendering. Deferring with queueMicrotask pushes
    // the update past the current render's commit phase.
    const update = () => {
      const states = Array.from(awareness.getStates().values())
      const next = states.filter(s => s.user).map(s => s.user as Peer)
      queueMicrotask(() => setPeers(next))
    }
    awareness.on('change', update)
    update()
    return () => { awareness.off('change', update) }
  }, [provider])

  return peers
}
