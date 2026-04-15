import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptJson, decryptJson } from '../src/crypto/encrypt.js'

describe('connector credential encryption', () => {
  const original = process.env.CONNECTOR_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.CONNECTOR_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  })
  afterAll(() => {
    if (original === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY
    else process.env.CONNECTOR_ENCRYPTION_KEY = original
  })

  it('round-trips a credential object', () => {
    const creds = { host: 'db.example.com', port: 5432, user: 'reader', password: 'hunter2' }
    const blob = encryptJson(creds)
    expect(blob).toContain('.')
    const decoded = decryptJson<typeof creds>(blob)
    expect(decoded).toEqual(creds)
  })

  it('produces different ciphertext for each encryption', () => {
    const value = { foo: 'bar' }
    const a = encryptJson(value)
    const b = encryptJson(value)
    expect(a).not.toBe(b)
    // Both decrypt to the same plaintext.
    expect(decryptJson(a)).toEqual(decryptJson(b))
  })

  it('rejects a tampered blob', () => {
    const blob = encryptJson({ secret: 'data' })
    const [iv, tag, ct] = blob.split('.')
    // Flip a byte in the ciphertext (base64-safe).
    const tampered = Buffer.from(ct, 'base64')
    tampered[0] ^= 0xff
    const bad = `${iv}.${tag}.${tampered.toString('base64')}`
    expect(() => decryptJson(bad)).toThrow()
  })

  it('rejects a malformed blob', () => {
    expect(() => decryptJson('not-a-blob')).toThrow(/Malformed/)
  })
})
