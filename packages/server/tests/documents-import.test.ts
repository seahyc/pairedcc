import { describe, it, expect } from 'vitest'
import { deriveTitle, shareUrl, withTitleHeading } from '../src/routes/documents.js'

describe('deriveTitle', () => {
  it('uses the first ATX heading', () => {
    expect(deriveTitle('# My Doc\n\nbody')).toBe('My Doc')
    expect(deriveTitle('intro\n\n## Second level\n')).toBe('Second level')
  })

  it('strips trailing closing hashes', () => {
    expect(deriveTitle('# Title #')).toBe('Title')
  })

  it('falls back to the first non-blank line, stripped of markdown', () => {
    expect(deriveTitle('\n\n**bold intro** here\n')).toBe('bold intro here')
  })

  it('returns null for empty/whitespace input', () => {
    expect(deriveTitle('')).toBeNull()
    expect(deriveTitle('   \n  \n')).toBeNull()
  })

  it('caps very long titles', () => {
    const long = '# ' + 'x'.repeat(500)
    expect(deriveTitle(long)!.length).toBe(200)
  })
})

describe('withTitleHeading', () => {
  it('does not duplicate the H1 when the body already starts with the title heading', () => {
    expect(withTitleHeading('Roadmap', '# Roadmap\n\nbody')).toBe('# Roadmap\n\nbody')
  })

  it('prepends the title when the body has no matching heading', () => {
    expect(withTitleHeading('Manual', 'just a paragraph')).toBe('# Manual\n\njust a paragraph')
  })

  it('prepends when the body opens with a different heading', () => {
    expect(withTitleHeading('Real Title', '# Other\n\nbody')).toBe('# Real Title\n\n# Other\n\nbody')
  })

  it('returns the body unchanged when there is no title', () => {
    expect(withTitleHeading(null, '# Body')).toBe('# Body')
  })
})

describe('shareUrl', () => {
  it('builds /d/:id from the origin', () => {
    expect(shareUrl('https://paired.cc', 'abc-123')).toBe('https://paired.cc/d/abc-123')
  })

  it('tolerates a trailing slash on the origin', () => {
    expect(shareUrl('https://paired.cc/', 'abc')).toBe('https://paired.cc/d/abc')
  })
})
