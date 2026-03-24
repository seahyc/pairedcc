import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { DocManager } from '../src/yjs/doc-manager.js'

describe('DocManager', () => {
  let manager: DocManager

  beforeEach(() => {
    manager = new DocManager()
  })

  it('creates and retrieves a doc', () => {
    const doc = manager.getOrCreate('doc-1')
    expect(doc).toBeInstanceOf(Y.Doc)
  })

  it('returns same doc instance for same id', () => {
    const doc1 = manager.getOrCreate('doc-1')
    const doc2 = manager.getOrCreate('doc-1')
    expect(doc1).toBe(doc2)
  })

  it('applies an update and reads content', () => {
    const doc = manager.getOrCreate('doc-1')
    const text = doc.getText('content')
    text.insert(0, 'Hello, world!')
    expect(manager.getMarkdown('doc-1')).toContain('Hello, world!')
  })
})
