/**
 * AES-256-GCM symmetric encryption for connector credentials.
 *
 * Key sourced from env (`CONNECTOR_ENCRYPTION_KEY`) — hex-encoded 32 bytes.
 * For V1 this is a single-key deployment. A real production setup should
 * use KMS (AWS/GCP/Azure) with envelope encryption and key rotation.
 *
 * Output format: `base64(iv) . base64(authTag) . base64(ciphertext)` —
 * dot-separated so a single-column TEXT storage is unambiguous.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32

function getKey(): Buffer {
  const raw = process.env.CONNECTOR_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'CONNECTOR_ENCRYPTION_KEY is not set. Generate one with: ' +
      '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`',
    )
  }
  const key = Buffer.from(raw, 'hex')
  if (key.length !== KEY_LENGTH) {
    throw new Error(`CONNECTOR_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes hex (got ${key.length})`)
  }
  return key
}

export function encryptJson(value: unknown): string {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decryptJson<T = unknown>(blob: string): T {
  const [ivB64, tagB64, ctB64] = blob.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted blob')
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  const decipher = createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8')) as T
}
