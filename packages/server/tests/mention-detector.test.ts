import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { detectMentions } from '../src/yjs/mention-detector.js'

describe('mention detector', () => {
  it('detects @agent-name in text', () => {
    const doc = new Y.Doc()
    const xml = doc.getXmlFragment('default')

    // Simulate a Tiptap mention node structure
    const el = new Y.XmlElement('mention')
    el.setAttribute('label', 'claude')
    el.setAttribute('id', 'claude')
    xml.insert(0, [el])

    const mentions = detectMentions(doc)
    expect(mentions).toHaveLength(1)
    expect(mentions[0].agentName).toBe('claude')
  })

  it('returns empty for no mentions', () => {
    const doc = new Y.Doc()
    doc.getText('content').insert(0, 'Hello world')
    const mentions = detectMentions(doc)
    expect(mentions).toHaveLength(0)
  })
})
