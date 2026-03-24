import * as Y from 'yjs'

/**
 * Single source of truth for all Yjs documents.
 * Both WebSocket handler and agent API use this same instance.
 */
export class DocManager {
  readonly docs = new Map<string, Y.Doc>()

  getOrCreate(docId: string): Y.Doc {
    let doc = this.docs.get(docId)
    if (!doc) {
      doc = new Y.Doc()
      this.docs.set(docId, doc)
    }
    return doc
  }

  getMarkdown(docId: string): string {
    const doc = this.docs.get(docId)
    if (!doc) return ''

    // Try all XmlFragments to find where Tiptap stores content
    for (const [key, type] of doc.share.entries()) {
      if (type instanceof Y.XmlFragment && type.length > 0) {
        return xmlFragmentToText(type)
      }
    }
    return ''
  }

  getState(docId: string): Uint8Array | null {
    const doc = this.docs.get(docId)
    if (!doc) return null
    return Y.encodeStateAsUpdate(doc)
  }

  editByAnchor(docId: string, anchor: string, newContent: string): boolean {
    const doc = this.getOrCreate(docId)

    // Find the active XML fragment
    let xml: Y.XmlFragment | null = null
    for (const [key, type] of doc.share.entries()) {
      if (type instanceof Y.XmlFragment && type.length > 0) {
        xml = type
        break
      }
    }

    if (!xml) {
      // No content yet — create in 'default' fragment
      xml = doc.getXmlFragment('default')
    }

    if (!anchor || anchor === '') {
      doc.transact(() => {
        const lines = newContent.split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          const p = new Y.XmlElement('paragraph')
          const text = new Y.XmlText(line)
          p.insert(0, [text])
          xml!.insert(xml!.length, [p])
        }
      })
      return true
    }

    const currentText = xmlFragmentToText(xml)
    if (!currentText.includes(anchor)) return false

    doc.transact(() => {
      replaceInXml(xml!, anchor, newContent)
    })
    return true
  }
}

function xmlFragmentToText(fragment: Y.XmlFragment): string {
  const parts: string[] = []
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i)
    if (child instanceof Y.XmlText) {
      parts.push(child.toString())
    } else if (child instanceof Y.XmlElement) {
      parts.push(xmlElementToText(child))
    }
  }
  return parts.join('\n')
}

function xmlElementToText(el: Y.XmlElement): string {
  const parts: string[] = []
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i)
    if (child instanceof Y.XmlText) {
      parts.push(child.toString())
    } else if (child instanceof Y.XmlElement) {
      parts.push(xmlElementToText(child))
    }
  }
  const text = parts.join('')
  switch (el.nodeName) {
    case 'heading': return '#'.repeat(Number(el.getAttribute('level') || 1)) + ' ' + text
    case 'listItem': return '- ' + text
    case 'codeBlock': return '```\n' + text + '\n```'
    case 'blockquote': return '> ' + text
    case 'horizontalRule': return '---'
    default: return text
  }
}

function replaceInXml(node: Y.XmlFragment | Y.XmlElement, anchor: string, replacement: string): boolean {
  for (let i = 0; i < node.length; i++) {
    const child = node.get(i)
    if (child instanceof Y.XmlText) {
      const text = child.toString()
      if (text.includes(anchor)) {
        const idx = text.indexOf(anchor)
        child.delete(idx, anchor.length)
        child.insert(idx, replacement)
        return true
      }
    } else if (child instanceof Y.XmlElement) {
      const elText = xmlElementToText(child)
      if (elText.includes(anchor)) {
        if (replaceInXml(child, anchor, replacement)) return true
      }
    }
  }
  return false
}
