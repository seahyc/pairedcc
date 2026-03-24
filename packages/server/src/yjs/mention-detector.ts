import * as Y from 'yjs'

export interface Mention {
  id: string
  agentName: string
  context: string
  timestamp: number
}

export function detectMentions(doc: Y.Doc): Mention[] {
  const mentions: Mention[] = []
  const xml = doc.getXmlFragment('default')

  function walk(node: Y.XmlElement | Y.XmlFragment) {
    if (node instanceof Y.XmlElement && node.nodeName === 'mention') {
      const label = node.getAttribute('label')
      if (label) {
        // Extract surrounding text from parent element
        const parent = (node as any)._parent
        const context = parent ? parent.toString().slice(0, 200) : ''
        mentions.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          agentName: label,
          context,
          timestamp: Date.now(),
        })
      }
    }
    // Walk children
    for (let i = 0; i < (node as any).length; i++) {
      const child = (node as any).get(i)
      if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
        walk(child)
      }
    }
  }

  walk(xml)
  return mentions
}
