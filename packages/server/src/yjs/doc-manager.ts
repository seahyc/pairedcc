import * as Y from 'yjs'

// Import the shared docs map from y-websocket's utils module.
// This is the SAME map that setupWSConnection uses to store docs.
// @ts-ignore
import utils from 'y-websocket/bin/utils'
const { docs, getYDoc } = utils

export class DocManager {
  /**
   * Get the Yjs doc managed by y-websocket server.
   * This is the SAME doc that browser clients connect to.
   */
  getOrCreate(docId: string): Y.Doc {
    // getYDoc creates or retrieves from the shared docs map
    return getYDoc(docId)
  }

  /**
   * List all active doc IDs
   */
  listActiveDocs(): string[] {
    return Array.from(docs.keys()) as string[]
  }

  /**
   * Read Tiptap content as plain text.
   * Tiptap stores content in an XmlFragment named 'default'.
   */
  getMarkdown(docId: string): string {
    const doc = this.getOrCreate(docId)
    const xml = doc.getXmlFragment('default')

    // Debug: also check all shared types
    const keys = Array.from(doc.share.keys())
    if (xml.length === 0 && keys.length > 0) {
      // Try prosemirror fragment name
      for (const key of keys) {
        const type = doc.share.get(key)
        if (type instanceof Y.XmlFragment && type.length > 0) {
          return xmlFragmentToText(type)
        }
      }
    }

    return xmlFragmentToText(xml)
  }

  getState(docId: string): Uint8Array | null {
    const doc = this.getOrCreate(docId)
    return Y.encodeStateAsUpdate(doc)
  }

  /**
   * Insert or replace text in the Tiptap XML fragment.
   */
  editByAnchor(docId: string, anchor: string, newContent: string): boolean {
    const doc = this.getOrCreate(docId)

    // Find the XML fragment Tiptap uses
    let xml = doc.getXmlFragment('default')
    const keys = Array.from(doc.share.keys())
    for (const key of keys) {
      const type = doc.share.get(key)
      if (type instanceof Y.XmlFragment && type.length > 0) {
        xml = type
        break
      }
    }

    if (!anchor || anchor === '') {
      // Append
      doc.transact(() => {
        const lines = newContent.split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          const p = new Y.XmlElement('paragraph')
          const text = new Y.XmlText(line)
          p.insert(0, [text])
          xml.insert(xml.length, [p])
        }
      })
      return true
    }

    const currentText = xmlFragmentToText(xml)
    if (!currentText.includes(anchor)) return false

    doc.transact(() => {
      replaceInXmlFragment(xml, anchor, newContent)
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
  const tag = el.nodeName
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

  switch (tag) {
    case 'heading': {
      const level = el.getAttribute('level') || 1
      return '#'.repeat(Number(level)) + ' ' + text
    }
    case 'bulletList':
    case 'orderedList':
      return text
    case 'listItem':
      return '- ' + text
    case 'codeBlock':
      return '```\n' + text + '\n```'
    case 'blockquote':
      return '> ' + text
    case 'horizontalRule':
      return '---'
    default:
      return text
  }
}

function replaceInXmlFragment(fragment: Y.XmlFragment, anchor: string, replacement: string): void {
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i)
    if (child instanceof Y.XmlText) {
      const text = child.toString()
      if (text.includes(anchor)) {
        const idx = text.indexOf(anchor)
        child.delete(idx, anchor.length)
        child.insert(idx, replacement)
        return
      }
    } else if (child instanceof Y.XmlElement) {
      const elText = xmlElementToText(child)
      if (elText.includes(anchor)) {
        replaceInXmlChildren(child, anchor, replacement)
        return
      }
    }
  }
}

function replaceInXmlChildren(el: Y.XmlElement, anchor: string, replacement: string): void {
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i)
    if (child instanceof Y.XmlText) {
      const text = child.toString()
      if (text.includes(anchor)) {
        const idx = text.indexOf(anchor)
        child.delete(idx, anchor.length)
        child.insert(idx, replacement)
        return
      }
    } else if (child instanceof Y.XmlElement) {
      const childText = xmlElementToText(child)
      if (childText.includes(anchor)) {
        replaceInXmlChildren(child, anchor, replacement)
        return
      }
    }
  }
}
