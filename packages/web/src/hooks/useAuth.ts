import { useState, useEffect } from 'react'
import { api } from '../api'

interface User { userId: string; email: string; name?: string }

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])

  return { user, loading }
}
