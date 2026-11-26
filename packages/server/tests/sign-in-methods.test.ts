import { describe, expect, it } from 'vitest'
import { signInMethods } from '../src/routes/auth.js'

describe('sign-in methods offered', () => {
  it('offers nothing when nothing is configured', () => {
    expect(signInMethods({})).toEqual({ github: false, google: false, magic: false })
  })

  it('needs both the id and the secret for an OAuth provider', () => {
    expect(signInMethods({ GITHUB_CLIENT_ID: 'id' }).github).toBe(false)
    expect(signInMethods({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' }).github).toBe(true)
    expect(signInMethods({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: '' }).google).toBe(false)
  })

  it('offers a magic link only when the server can send email', () => {
    expect(signInMethods({ SMTP_URL: '' }).magic).toBe(false)
    expect(signInMethods({ SMTP_URL: 'smtp://mail.example' }).magic).toBe(true)
  })
})
