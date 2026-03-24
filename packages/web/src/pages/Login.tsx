import { useState } from 'react'
import { api } from '../api'

export function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  const sendMagicLink = async () => {
    await api('/auth/magic/send', { method: 'POST', body: JSON.stringify({ email }) })
    setSent(true)
  }

  return (
    <div className="login-page">
      <h1>paired.cc</h1>
      <p>Collaborative documents with AI agents</p>
      <div className="login-buttons">
        <a href="/auth/github/login" className="btn btn-github">Sign in with GitHub</a>
        <a href="/auth/google/login" className="btn btn-google">Sign in with Google</a>
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
