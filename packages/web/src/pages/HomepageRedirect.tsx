import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const COOKIE_KEY = 'pairedcc_doc'

function getStoredDocId(): string | null {
  return localStorage.getItem(COOKIE_KEY)
}

function storeDocId(docId: string) {
  localStorage.setItem(COOKIE_KEY, docId)
}

/**
 * The homepage IS the product.
 * First visit: creates an anonymous doc and stores the ID.
 * Subsequent visits: redirects to the same doc.
 */
export function HomepageRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    const existing = getStoredDocId()

    if (existing) {
      // Verify the doc still exists (might have expired)
      api(`/api/documents/${existing}`)
        .then(() => {
          navigate(`/d/${existing}`, { replace: true })
        })
        .catch(() => {
          // Doc expired or deleted — create a new one
          createNewDoc()
        })
    } else {
      createNewDoc()
    }

    function createNewDoc() {
      api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ title: 'Welcome to paired.cc' }),
      }).then((doc) => {
        storeDocId(doc.id)
        sessionStorage.setItem('pairedcc:just-created', doc.id)
        navigate(`/d/${doc.id}`, { replace: true })
      })
    }
  }, [])

  return <div className="loading">Loading...</div>
}
