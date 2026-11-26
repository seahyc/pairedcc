import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import './login.css'

type Methods = { github: boolean; google: boolean; magic: boolean }

export function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)
  const [methods, setMethods] = useState<Methods | null>(null)
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo') || '/docs'
  const query = `?returnTo=${encodeURIComponent(returnTo)}`

  useEffect(() => {
    api<Methods>('/auth/methods')
      .then(setMethods)
      .catch(() => setMethods({ github: false, google: false, magic: false }))
  }, [])

  const sendMagicLink = async () => {
    setFailed(false)
    try {
      await api('/auth/magic/send', { method: 'POST', body: JSON.stringify({ email, returnTo }) })
      setSent(true)
    } catch {
      setFailed(true)
    }
  }

  const none = methods && !methods.github && !methods.google && !methods.magic

  return (
    <main className="signin">
      <section className="signin-card">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="signin-logo" />
        <h1 className="signin-title">Sign in to Paired</h1>
        <p className="signin-lede">A place to think, with an agent beside you.</p>

        {methods?.github && (
          <a href={`/auth/github/login${query}`} className="signin-button signin-primary">Continue with GitHub</a>
        )}
        {methods?.google && (
          <a href={`/auth/google/login${query}`} className="signin-button">Continue with Google</a>
        )}

        {methods?.magic && (
          sent ? (
            <p className="signin-note">We sent a sign-in link to {email}. It works for 15 minutes.</p>
          ) : (
            <form className="signin-form" onSubmit={(e) => { e.preventDefault(); sendMagicLink() }}>
              {(methods.github || methods.google) && <p className="signin-or">or use your email</p>}
              <label className="signin-label" htmlFor="signin-email">Email</label>
              <input id="signin-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="signin-input" />
              <button type="submit" className="signin-button">Email me a sign-in link</button>
              {failed && <p className="signin-error">We couldn't send the link. Try again.</p>}
            </form>
          )
        )}

        {none && <p className="signin-error">Sign-in isn't set up on this server yet.</p>}
      </section>
    </main>
  )
}
