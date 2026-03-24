import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

/**
 * The homepage IS the product.
 * Visiting paired.cc immediately creates a fresh anonymous doc
 * pre-filled with getting-started instructions, and redirects to it.
 */
export function HomepageRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    api('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Welcome to paired.cc' }),
    }).then((doc) => {
      navigate(`/d/${doc.id}`, { replace: true })
    })
  }, [])

  return <div className="loading">Creating your document...</div>
}
