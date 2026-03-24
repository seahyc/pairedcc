import { useState, useEffect } from 'react'
import type { WebsocketProvider } from 'y-websocket'

interface Peer { name: string; color: string; isAgent?: boolean }

export function usePresence(provider: WebsocketProvider | null) {
  const [peers, setPeers] = useState<Peer[]>([])

  useEffect(() => {
    if (!provider) return
    const awareness = provider.awareness
    const update = () => {
      const states = Array.from(awareness.getStates().values())
      setPeers(states.filter(s => s.user).map(s => s.user as Peer))
    }
    awareness.on('change', update)
    update()
    return () => { awareness.off('change', update) }
  }, [provider])

  return peers
}
