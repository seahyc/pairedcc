import { describe, it, expect } from 'vitest'
import { DocManager } from '../src/yjs/doc-manager.js'

describe('DocManager.getBlockTextByAnchor', () => {
  it('returns the current text of the block containing the anchor', () => {
    const m = new DocManager()
    m.importMarkdown('d1', '# Title\n\nThe quick brown fox jumps.\n\nAnother paragraph.')
    // Anchor on a snippet of the second paragraph.
    const text = m.getBlockTextByAnchor('d1', 'quick brown fox')
    expect(text).toBe('The quick brown fox jumps.')
  })

  it('resolves an anchor inside a heading to the heading text', () => {
    const m = new DocManager()
    m.importMarkdown('d2', '# My Heading\n\nbody text here')
    expect(m.getBlockTextByAnchor('d2', 'My Heading')).toContain('My Heading')
  })

  it('reflects edits made after the comment was created', () => {
    const m = new DocManager()
    m.importMarkdown('d3', 'original sentence about cats')
    // Edit the block via the same anchor contract the agent uses.
    m.editByAnchor('d3', 'cats', 'dogs')
    expect(m.getBlockTextByAnchor('d3', 'dogs')).toContain('dogs')
    expect(m.getBlockTextByAnchor('d3', 'original sentence')).toContain('dogs')
  })

  it('returns null when the anchor no longer resolves', () => {
    const m = new DocManager()
    m.importMarkdown('d4', 'some content')
    expect(m.getBlockTextByAnchor('d4', 'nonexistent snippet')).toBeNull()
  })

  it('returns null for an unknown doc', () => {
    const m = new DocManager()
    expect(m.getBlockTextByAnchor('missing', 'x')).toBeNull()
  })
})
