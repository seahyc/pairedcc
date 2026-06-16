import { describe, it, expect } from 'vitest'
import {
  isUuid,
  isStatus,
  isValidBlockAnchor,
  validateBody,
  parseTags,
  tagsAssignAgent,
  LIMITS,
  safeJson,
} from '../src/comments/logic.js'

describe('isUuid', () => {
  it('accepts canonical uuids, rejects junk', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('123e4567e89b12d3a456426614174000')).toBe(false)
    expect(isUuid(42 as unknown)).toBe(false)
    expect(isUuid("'; DROP TABLE comments; --")).toBe(false)
  })
})

describe('isStatus', () => {
  it('only allows open/resolved', () => {
    expect(isStatus('open')).toBe(true)
    expect(isStatus('resolved')).toBe(true)
    expect(isStatus('deleted')).toBe(false)
    expect(isStatus(undefined)).toBe(false)
  })
})

describe('isValidBlockAnchor', () => {
  it('requires non-empty, bounded text', () => {
    expect(isValidBlockAnchor('Some block text')).toBe(true)
    expect(isValidBlockAnchor('b-abc123')).toBe(true)
    expect(isValidBlockAnchor('')).toBe(false)
    expect(isValidBlockAnchor('   ')).toBe(false)
    expect(isValidBlockAnchor('x'.repeat(2001))).toBe(false)
    expect(isValidBlockAnchor(null)).toBe(false)
  })
})

describe('validateBody', () => {
  it('trims and accepts normal bodies', () => {
    const r = validateBody('  hello world  ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('hello world')
  })

  it('rejects empty / non-string with 400', () => {
    expect(validateBody('').ok).toBe(false)
    expect(validateBody('   ').ok).toBe(false)
    const r = validateBody(123 as unknown)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('rejects oversize bodies with 413', () => {
    const r = validateBody('x'.repeat(LIMITS.COMMENT_BODY + 1))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(413)
  })
})

describe('parseTags', () => {
  it('extracts human tags', () => {
    const tags = parseTags('hey @alice and @bob can you look?')
    expect(tags).toEqual([
      { target_type: 'human', target: 'alice' },
      { target_type: 'human', target: 'bob' },
    ])
  })

  it('routes @agent and @claude to the agent', () => {
    expect(tagsAssignAgent(parseTags('please fix @agent'))).toBe(true)
    expect(tagsAssignAgent(parseTags('hi @claude'))).toBe(true)
    expect(tagsAssignAgent(parseTags('hi @alice'))).toBe(false)
  })

  it('dedupes case-insensitively', () => {
    const tags = parseTags('@Alice @alice @ALICE')
    expect(tags).toHaveLength(1)
  })

  it('does not treat an email as a tag', () => {
    // The char before @ is a word char, so foo@bar is not a tag.
    const tags = parseTags('reach me at foo@example.com')
    expect(tags).toHaveLength(0)
  })

  it('strips trailing punctuation', () => {
    const tags = parseTags('cc @bob, thanks!')
    expect(tags).toEqual([{ target_type: 'human', target: 'bob' }])
  })

  it('merges explicit structured tags and dedupes against body', () => {
    const tags = parseTags('hi @alice', [
      { target_type: 'human', target: 'alice' },
      { target_type: 'agent', target: 'claude' },
    ])
    expect(tags).toContainEqual({ target_type: 'human', target: 'alice' })
    expect(tags).toContainEqual({ target_type: 'agent', target: 'claude' })
    expect(tags.filter((t) => t.target.toLowerCase() === 'alice')).toHaveLength(1)
  })

  it('bounds the number of tags', () => {
    const body = Array.from({ length: 100 }, (_, i) => `@u${i}`).join(' ')
    expect(parseTags(body).length).toBe(LIMITS.TAGS_PER_COMMENT)
  })

  it('bounds an over-long tag name to <= 128 chars', () => {
    const tags = parseTags('@' + 'x'.repeat(200))
    expect(tags).toHaveLength(1)
    expect(tags[0].target.length).toBeLessThanOrEqual(128)
  })
})

describe('safeJson', () => {
  it('returns parsed object', async () => {
    expect(await safeJson({ json: async () => ({ a: 1 }) })).toEqual({ a: 1 })
  })
  it('returns {} on throw or non-object', async () => {
    expect(await safeJson({ json: async () => { throw new Error('bad') } })).toEqual({})
    expect(await safeJson({ json: async () => 'a string' })).toEqual({})
    expect(await safeJson({ json: async () => null })).toEqual({})
  })
})
