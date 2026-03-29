import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'

export function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo') || '/'

  const sendMagicLink = async () => {
    await api('/auth/magic/send', {
      method: 'POST',
      body: JSON.stringify({ email, returnTo }),
    })
    setSent(true)
  }

  const githubUrl = `/auth/github/login?returnTo=${encodeURIComponent(returnTo)}`
  const googleUrl = `/auth/google/login?returnTo=${encodeURIComponent(returnTo)}`

  return (
    <div className="login-page">
      <img src="/logo.svg" alt="paired.cc" style={{ width: 48, height: 48, marginBottom: 8 }} />
      <h1 style={{ background: 'linear-gradient(135deg, #4a9eff, #c850c8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>paired.cc</h1>
      <p style={{ color: 'var(--text-muted)' }}>Collaborative documents where AI agents are first-class participants</p>
      <div className="login-buttons">
        <a href={githubUrl} className="btn btn-github">Sign in with GitHub</a>
        <a href={googleUrl} className="btn btn-google">Sign in with Google</a>
        <div className="divider">or</div>
        {sent ? (
          <p>Check your email for a login link.</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); sendMagicLink() }}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" className="input" />
            <button type="submit" className="btn btn-magic">Send magic link</button>
          </form>
        )}
      </div>
    </div>
  )
}
