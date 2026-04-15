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

    for (const [, type] of doc.share.entries()) {
      if (type instanceof Y.XmlFragment && type.length > 0) {
        return fragmentToMarkdown(type).replace(/\n{3,}/g, '\n\n').trim() + '\n'
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

// ---- Markdown serializer (Tiptap schema → markdown) ----
// Used by the agent / WebFetch raw endpoint. Handles block + inline marks
// for the node types our editor configures.

interface ListCtx { type: 'bullet' | 'ordered'; index: number; depth: number }

function fragmentToMarkdown(fragment: Y.XmlFragment, list?: ListCtx): string {
  const out: string[] = []
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i)
    if (child instanceof Y.XmlElement) {
      out.push(blockToMarkdown(child, list))
    } else if (child instanceof Y.XmlText) {
      out.push(inlineToMarkdown(child))
    }
  }
  return out.filter(s => s.length > 0).join('\n\n')
}

function blockToMarkdown(el: Y.XmlElement, list?: ListCtx): string {
  switch (el.nodeName) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(el.getAttribute('level') || 1)))
      return '#'.repeat(level) + ' ' + inlineChildren(el)
    }
    case 'paragraph':
      return inlineChildren(el)
    case 'bulletList':
      return childrenAsList(el, { type: 'bullet', index: 0, depth: (list?.depth ?? -1) + 1 })
    case 'orderedList':
      return childrenAsList(el, { type: 'ordered', index: 0, depth: (list?.depth ?? -1) + 1 })
    case 'listItem': {
      if (!list) return inlineChildren(el)
      const marker = list.type === 'bullet' ? '- ' : `${++list.index}. `
      const indent = '  '.repeat(list.depth)
      const inner = serializeListItem(el, list)
      return inner.split('\n').map((line, idx) => idx === 0 ? indent + marker + line : indent + '  ' + line).join('\n')
    }
    case 'taskList':
      return childrenAsList(el, { type: 'bullet', index: 0, depth: (list?.depth ?? -1) + 1 })
    case 'taskItem': {
      const checked = el.getAttribute('checked') === 'true'
      const indent = '  '.repeat(list?.depth ?? 0)
      return `${indent}- [${checked ? 'x' : ' '}] ${inlineChildren(el)}`
    }
    case 'codeBlock': {
      const lang = el.getAttribute('language') || ''
      return '```' + lang + '\n' + plainText(el) + '\n```'
    }
    case 'blockquote':
      return inlineChildren(el).split('\n').map(l => '> ' + l).join('\n')
    case 'horizontalRule':
      return '---'
    case 'hardBreak':
      return '  \n'
    case 'image': {
      const src = el.getAttribute('src') || ''
      const alt = el.getAttribute('alt') || ''
      return `![${alt}](${src})`
    }
    case 'mention': {
      const id = el.getAttribute('id') || el.getAttribute('label') || ''
      return `@${id}`
    }
    case 'mermaidBlock':
    case 'mermaid':
      return '```mermaid\n' + plainText(el) + '\n```'
    case 'mathBlock':
    case 'math':
      return '$$\n' + plainText(el) + '\n$$'
    case 'table':
      return tableToMarkdown(el)
    default:
      return inlineChildren(el)
  }
}

function serializeListItem(el: Y.XmlElement, list: ListCtx): string {
  const parts: string[] = []
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i)
    if (child instanceof Y.XmlElement) {
      // A nested list inside a listItem is its own context with depth+1.
      if (child.nodeName === 'bulletList' || child.nodeName === 'orderedList') {
        parts.push(blockToMarkdown(child, list))
      } else {
        parts.push(blockToMarkdown(child, list))
      }
    } else if (child instanceof Y.XmlText) {
      parts.push(inlineToMarkdown(child))
    }
  }
  return parts.filter(p => p.length).join('\n')
}

function childrenAsList(el: Y.XmlElement, ctx: ListCtx): string {
  const lines: string[] = []
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i)
    if (child instanceof Y.XmlElement) {
      lines.push(blockToMarkdown(child, ctx))
    }
  }
  return lines.join('\n')
}

function tableToMarkdown(el: Y.XmlElement): string {
  const rows: string[][] = []
  let headerSeen = false
  let hasHeader = false
  for (let i = 0; i < el.length; i++) {
    const row = el.get(i)
    if (!(row instanceof Y.XmlElement) || row.nodeName !== 'tableRow') continue
    const cells: string[] = []
    let isHeaderRow = false
    for (let j = 0; j < row.length; j++) {
      const cell = row.get(j)
      if (cell instanceof Y.XmlElement) {
        if (cell.nodeName === 'tableHeader') isHeaderRow = true
        cells.push(inlineChildren(cell).replace(/\n+/g, ' ').replace(/\|/g, '\\|'))
      }
    }
    if (cells.length === 0) continue
    if (isHeaderRow && !headerSeen) hasHeader = true
    headerSeen = true
    rows.push(cells)
  }
  if (rows.length === 0) return ''
  const cols = rows[0].length
  const sep = `| ${Array(cols).fill('---').join(' | ')} |`
  const lines = [`| ${rows[0].join(' | ')} |`, sep]
  for (let i = 1; i < rows.length; i++) lines.push(`| ${rows[i].join(' | ')} |`)
  // If first row wasn't an explicit header but we still need a separator for valid GFM,
  // the above already inserts one after row 0 — that matches markdown's "first row = header" convention.
  return lines.join('\n') + (hasHeader ? '' : '')
}

function inlineChildren(el: Y.XmlElement): string {
  const parts: string[] = []
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i)
    if (child instanceof Y.XmlText) parts.push(inlineToMarkdown(child))
    else if (child instanceof Y.XmlElement) parts.push(blockToMarkdown(child))
  }
  return parts.join('')
}

function plainText(el: Y.XmlElement): string {
  const parts: string[] = []
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i)
    if (child instanceof Y.XmlText) parts.push(child.toString())
    else if (child instanceof Y.XmlElement) parts.push(plainText(child))
  }
  return parts.join('')
}

function inlineToMarkdown(text: Y.XmlText): string {
  // Y.XmlText.toDelta() preserves marks as attributes on each segment.
  const delta = text.toDelta() as Array<{ insert: string; attributes?: Record<string, any> }>
  return delta.map(seg => applyMarks(seg.insert ?? '', seg.attributes)).join('')
}

function applyMarks(s: string, attrs?: Record<string, any>): string {
  if (!s) return ''
  if (!attrs) return s
  let out = s
  // Apply in inside-out order so wrappers don't break each other.
  if (attrs.code) out = '`' + out + '`'
  if (attrs.strike) out = '~~' + out + '~~'
  if (attrs.italic) out = '*' + out + '*'
  if (attrs.bold) out = '**' + out + '**'
  if (attrs.link) {
    const href = typeof attrs.link === 'object' ? attrs.link.href : attrs.link
    if (href) out = `[${out}](${href})`
  }
  return out
}

// ---- Legacy plain-text walkers (used by editByAnchor) ----

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
