import { describe, it, expect } from 'vitest'
import { signJwt, verifyJwt } from '../src/auth/jwt.js'

describe('JWT', () => {
  it('signs and verifies a token', () => {
    const payload = { userId: 'test-id', email: 'test@example.com' }
    const token = signJwt(payload)
    const decoded = verifyJwt(token)
    expect(decoded.userId).toBe('test-id')
    expect(decoded.email).toBe('test@example.com')
  })

  it('rejects invalid tokens', () => {
    expect(() => verifyJwt('garbage')).toThrow()
  })
})
