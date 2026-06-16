import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { DocManager } from '../src/yjs/doc-manager.js'

/**
 * Stored-XSS guard for the public markdown-import path. The importer builds
 * Yjs nodes directly (never innerHTML), so raw HTML in untrusted markdown must
 * survive as inert TEXT, and dangerous block-level HTML must not create an
 * executable node. Tiptap/ProseMirror render Y.XmlText as escaped text.
 */
describe('markdown import does not pass through executable HTML', () => {
  it('keeps inline raw HTML as literal text, not a script node', () => {
    const m = new DocManager()
    m.importMarkdown('x1', 'Hello <script>alert(1)</script> world')
    const md = m.getMarkdown('x1')
    // The dangerous markup round-trips as plain text inside a paragraph; there
    // is no script element in the Yjs tree.
    const doc = (m as unknown as { docs: Map<string, Y.Doc> }).docs.get('x1')!
    const frag = doc.getXmlFragment('default')
    let hasScriptEl = false
    const walk = (n: Y.XmlElement | Y.XmlFragment) => {
      for (let i = 0; i < n.length; i++) {
        const ch = n.get(i)
        if (ch instanceof Y.XmlElement) {
          if (ch.nodeName.toLowerCase() === 'script') hasScriptEl = true
          walk(ch)
        }
      }
    }
    walk(frag)
    expect(hasScriptEl).toBe(false)
    // The text is preserved (as data), so nothing is silently lost either.
    expect(md).toContain('alert(1)')
  })

  it('does not create an img/onerror element from block HTML', () => {
    const m = new DocManager()
    m.importMarkdown('x2', '<img src=x onerror=alert(1)>\n\nnext para')
    const doc = (m as unknown as { docs: Map<string, Y.Doc> }).docs.get('x2')!
    const frag = doc.getXmlFragment('default')
    let hasImg = false
    for (let i = 0; i < frag.length; i++) {
      const ch = frag.get(i)
      if (ch instanceof Y.XmlElement && ch.nodeName.toLowerCase() === 'image') hasImg = true
    }
    expect(hasImg).toBe(false)
  })
})
