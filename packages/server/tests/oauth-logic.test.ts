import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { agentName, consentToken, isAllowedRedirectUri, redirectMatches, verifyPkce } from '../src/oauth/logic.js'

describe('PKCE', () => {
  const verifier = 'a'.repeat(43) + 'B-._~9'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  it('accepts the matching verifier', () => expect(verifyPkce(verifier, challenge)).toBe(true))
  it('rejects a different verifier', () => expect(verifyPkce('b'.repeat(50), challenge)).toBe(false))
  it('rejects a short verifier', () => expect(verifyPkce('short', challenge)).toBe(false))
})

describe('redirect URIs', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://localhost:51234/callback', true],
    ['http://127.0.0.1:8080/cb', true],
    ['cursor://anysphere.cursor-retrieval/oauth/user-paired/callback', true],
    ['http://evil.example/callback', false],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['https://ok.example/cb#frag', false],
    ['not a url', false],
  ])('%s → %s', (uri, ok) => expect(isAllowedRedirectUri(uri)).toBe(ok))

  it('matches exactly, or loopback on any port', () => {
    const registered = ['http://127.0.0.1:3333/callback', 'https://app.example/cb']
    expect(redirectMatches(registered, 'https://app.example/cb')).toBe(true)
    expect(redirectMatches(registered, 'http://127.0.0.1:4444/callback')).toBe(true)
    expect(redirectMatches(registered, 'http://127.0.0.1:4444/other')).toBe(false)
    expect(redirectMatches(registered, 'https://app.example/cb2')).toBe(false)
    expect(redirectMatches(registered, 'http://localhost:3333/callback')).toBe(false)
  })
})

describe('agent names', () => {
  it('never lets a client pose as the human', () => {
    expect(agentName('Human')).toBe('Agent')
    expect(agentName(' human ')).toBe('Agent')
    expect(agentName('')).toBe('Agent')
    expect(agentName(undefined)).toBe('Agent')
  })
  it('keeps real client names, trimmed', () => {
    expect(agentName('Claude Code')).toBe('Claude Code')
    expect(agentName('x'.repeat(100))).toHaveLength(60)
    expect(agentName('Bad\u0000Name')).toBe('BadName')
  })
})

describe('consent token', () => {
  it('is bound to the user and the request', () => {
    const a = consentToken('secret-secret-secret', 'u1', '["c","r"]')
    expect(consentToken('secret-secret-secret', 'u1', '["c","r"]')).toBe(a)
    expect(consentToken('secret-secret-secret', 'u2', '["c","r"]')).not.toBe(a)
    expect(consentToken('secret-secret-secret', 'u1', '["c","x"]')).not.toBe(a)
  })
})
