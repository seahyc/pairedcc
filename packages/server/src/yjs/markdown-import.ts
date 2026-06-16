/**
 * Markdown → Yjs importer (server side).
 *
 * The inverse of the markdown serializer in `doc-manager.ts`. Produces the
 * exact same Y.XmlFragment('default') / pccBlocks layout the Tiptap editor
 * builds in the browser, so a human opening the doc sees normal, editable
 * blocks and live collaboration works against the imported state.
 *
 * Node names mirror the Tiptap schema the editor configures (see
 * packages/web/src/components/editor/TiptapEditor.tsx): heading, paragraph,
 * bulletList / orderedList / listItem, taskList / taskItem, codeBlock,
 * blockquote, horizontalRule, image, table / tableRow / tableHeader /
 * tableCell. Inline marks (bold, italic, code, strike, link) are stored as
 * Y.XmlText delta attributes, matching what `inlineToMarkdown` reads back.
 *
 * paired.cc-flavored fences (```pairedcc:<type> <anchor>) round-trip into a
 * `pccBlock` element plus a `pccBlocks` map entry, so agent-authored blocks
 * survive a markdown export → import cycle.
 */

import * as Y from 'yjs'
import { marked, type Token, type Tokens } from 'marked'
import { upsertBlock, isAnchor } from './blocks.js'

const PCC_FENCE = /^pairedcc:([a-zA-Z0-9_-]+)\s+(\S+)\s*$/

interface InlineSeg {
  text: string
  attrs?: Record<string, unknown>
}

/**
 * Parse a markdown string and write it into `doc` as Tiptap-schema Yjs nodes.
 * Replaces any existing content in the `default` fragment.
 */
export function importMarkdown(doc: Y.Doc, markdown: string): void {
  const tokens = marked.lexer(markdown)
  const frag = doc.getXmlFragment('default')

  doc.transact(() => {
    // Clear existing content so import is deterministic (replace, not append).
    if (frag.length > 0) frag.delete(0, frag.length)
    const nodes = tokensToNodes(tokens, doc)
    if (nodes.length > 0) frag.insert(0, nodes)
  })
}

function tokensToNodes(tokens: Token[], doc: Y.Doc): Y.XmlElement[] {
  const out: Y.XmlElement[] = []
  for (const tok of tokens) {
    const node = blockTokenToNode(tok, doc)
    if (Array.isArray(node)) out.push(...node)
    else if (node) out.push(node)
  }
  return out
}

function blockTokenToNode(tok: Token, doc: Y.Doc): Y.XmlElement | Y.XmlElement[] | null {
  switch (tok.type) {
    case 'space':
      return null

    case 'heading': {
      const t = tok as Tokens.Heading
      const el = new Y.XmlElement('heading')
      el.setAttribute('level', String(Math.min(6, Math.max(1, t.depth))))
      appendInline(el, inlineSegments(t.tokens ?? [{ type: 'text', raw: t.text, text: t.text } as Token]))
      return el
    }

    case 'paragraph': {
      const t = tok as Tokens.Paragraph
      const el = new Y.XmlElement('paragraph')
      appendInline(el, inlineSegments(t.tokens ?? []))
      return el
    }

    case 'text': {
      // Loose text at the block level (e.g. between list items) → paragraph.
      const t = tok as Tokens.Text
      const el = new Y.XmlElement('paragraph')
      appendInline(el, inlineSegments(t.tokens ?? [{ type: 'text', raw: t.text, text: t.text } as Token]))
      return el
    }

    case 'code': {
      const t = tok as Tokens.Code
      const fence = (t.lang ?? '').trim()
      const pcc = fence.match(PCC_FENCE)
      if (pcc) {
        return pccBlockNode(doc, pcc[1], pcc[2], t.text)
      }
      const el = new Y.XmlElement('codeBlock')
      if (fence) el.setAttribute('language', fence)
      el.insert(0, [new Y.XmlText(t.text)])
      return el
    }

    case 'blockquote': {
      const t = tok as Tokens.Blockquote
      const el = new Y.XmlElement('blockquote')
      const inner = tokensToNodes(t.tokens ?? [], doc)
      if (inner.length > 0) el.insert(0, inner)
      return el
    }

    case 'hr':
      return new Y.XmlElement('horizontalRule')

    case 'list':
      return listToNode(tok as Tokens.List, doc)

    case 'table':
      return tableToNode(tok as Tokens.Table, doc)

    default:
      return null
  }
}

function listToNode(list: Tokens.List, doc: Y.Doc): Y.XmlElement {
  const isTask = list.items.some((it) => it.task)
  if (isTask) {
    const el = new Y.XmlElement('taskList')
    const items: Y.XmlElement[] = []
    for (const it of list.items) {
      const item = new Y.XmlElement('taskItem')
      item.setAttribute('checked', it.checked ? 'true' : 'false')
      // Task items hold inline content directly in the editor schema.
      const segs = inlineSegments(itemInlineTokens(it))
      appendInline(item, segs)
      items.push(item)
    }
    el.insert(0, items)
    return el
  }

  const el = new Y.XmlElement(list.ordered ? 'orderedList' : 'bulletList')
  const items: Y.XmlElement[] = []
  for (const it of list.items) {
    items.push(listItemToNode(it, doc))
  }
  el.insert(0, items)
  return el
}

function listItemToNode(item: Tokens.ListItem, doc: Y.Doc): Y.XmlElement {
  const li = new Y.XmlElement('listItem')
  const children: Y.XmlElement[] = []
  // A list item's tokens are a mix of inline-bearing text tokens and nested
  // block tokens (sub-lists). Wrap inline content in a paragraph, recurse on
  // nested lists — exactly the tree the serializer walks.
  const inlineRun: Token[] = []
  const flushInline = () => {
    if (inlineRun.length === 0) return
    const p = new Y.XmlElement('paragraph')
    appendInline(p, inlineSegments(inlineRun))
    children.push(p)
    inlineRun.length = 0
  }
  for (const child of item.tokens ?? []) {
    if (child.type === 'list') {
      flushInline()
      children.push(listToNode(child as Tokens.List, doc))
    } else if (child.type === 'text') {
      const t = child as Tokens.Text
      inlineRun.push(...(t.tokens ?? [{ type: 'text', raw: t.text, text: t.text } as Token]))
    } else {
      flushInline()
      const node = blockTokenToNode(child, doc)
      if (Array.isArray(node)) children.push(...node)
      else if (node) children.push(node)
    }
  }
  flushInline()
  if (children.length === 0) children.push(new Y.XmlElement('paragraph'))
  li.insert(0, children)
  return li
}

/** Inline tokens for a (non-task) list item top-level text run. */
function itemInlineTokens(item: Tokens.ListItem): Token[] {
  const out: Token[] = []
  for (const child of item.tokens ?? []) {
    if (child.type === 'text') {
      const t = child as Tokens.Text
      out.push(...(t.tokens ?? [{ type: 'text', raw: t.text, text: t.text } as Token]))
    }
  }
  if (out.length === 0) out.push({ type: 'text', raw: item.text, text: item.text } as Token)
  return out
}

function tableToNode(table: Tokens.Table, doc: Y.Doc): Y.XmlElement {
  const el = new Y.XmlElement('table')
  const rows: Y.XmlElement[] = []

  const headerRow = new Y.XmlElement('tableRow')
  const headerCells: Y.XmlElement[] = []
  for (const cell of table.header) {
    const th = new Y.XmlElement('tableHeader')
    const p = new Y.XmlElement('paragraph')
    appendInline(p, inlineSegments(cell.tokens ?? []))
    th.insert(0, [p])
    headerCells.push(th)
  }
  headerRow.insert(0, headerCells)
  rows.push(headerRow)

  for (const row of table.rows) {
    const tr = new Y.XmlElement('tableRow')
    const cells: Y.XmlElement[] = []
    for (const cell of row) {
      const td = new Y.XmlElement('tableCell')
      const p = new Y.XmlElement('paragraph')
      appendInline(p, inlineSegments(cell.tokens ?? []))
      td.insert(0, [p])
      cells.push(td)
    }
    tr.insert(0, cells)
    rows.push(tr)
  }

  el.insert(0, rows)
  return el
}

/**
 * Build a pccBlock element + register its map entry. The fence body is the
 * JSON `{ props, state }` emitted by the serializer. If the body doesn't
 * parse or the anchor is malformed, we still emit the element so the slot
 * round-trips (mirrors the serializer's stub-fence behavior).
 */
function pccBlockNode(doc: Y.Doc, type: string, anchor: string, body: string): Y.XmlElement {
  const el = new Y.XmlElement('pccBlock')
  const safeAnchor = isAnchor(anchor) ? anchor : 'b-orphan'
  el.setAttribute('anchor', safeAnchor)
  if (type === 'unknown') return el

  let props: unknown = null
  let state: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(body) as { props?: unknown; state?: Record<string, unknown> }
    props = parsed.props ?? null
    state = parsed.state
  } catch {
    // Leave props/state empty; the element still anchors the slot.
  }
  if (isAnchor(safeAnchor)) {
    upsertBlock(doc, safeAnchor, { type, props, state })
  }
  return el
}

// ---- Inline handling ----

function inlineSegments(tokens: Token[]): InlineSeg[] {
  const segs: InlineSeg[] = []
  walkInline(tokens, undefined, segs)
  return segs
}

function walkInline(tokens: Token[], marks: Record<string, unknown> | undefined, out: InlineSeg[]): void {
  for (const tok of tokens) {
    switch (tok.type) {
      case 'text': {
        const t = tok as Tokens.Text
        if (t.tokens && t.tokens.length > 0) {
          walkInline(t.tokens, marks, out)
        } else {
          out.push({ text: decodeEntities(t.text), attrs: marks })
        }
        break
      }
      case 'escape': {
        const t = tok as Tokens.Escape
        out.push({ text: t.text, attrs: marks })
        break
      }
      case 'strong':
        walkInline((tok as Tokens.Strong).tokens, { ...marks, bold: true }, out)
        break
      case 'em':
        walkInline((tok as Tokens.Em).tokens, { ...marks, italic: true }, out)
        break
      case 'del':
        walkInline((tok as Tokens.Del).tokens, { ...marks, strike: true }, out)
        break
      case 'codespan':
        out.push({ text: decodeEntities((tok as Tokens.Codespan).text), attrs: { ...marks, code: true } })
        break
      case 'link': {
        const t = tok as Tokens.Link
        walkInline(t.tokens, { ...marks, link: { href: t.href } }, out)
        break
      }
      case 'image': {
        // Inline images render to an image node in the editor, but inside a
        // paragraph the serializer expects block-level images. Keep it simple:
        // emit the alt text as a link-less segment so content isn't lost.
        const t = tok as Tokens.Image
        out.push({ text: t.text || t.href, attrs: marks })
        break
      }
      case 'br':
        out.push({ text: '\n', attrs: marks })
        break
      case 'html':
        out.push({ text: (tok as Tokens.HTML).text, attrs: marks })
        break
      default: {
        const anyTok = tok as { tokens?: Token[]; text?: string }
        if (anyTok.tokens) walkInline(anyTok.tokens, marks, out)
        else if (typeof anyTok.text === 'string') out.push({ text: anyTok.text, attrs: marks })
      }
    }
  }
}

function appendInline(el: Y.XmlElement, segs: InlineSeg[]): void {
  if (segs.length === 0) return

  // Union of every mark key used across segments. Yjs formatting inherits
  // from the preceding range, so each insert must pass EVERY key explicitly
  // (value or null) — otherwise e.g. a bold word bleeds its mark into the
  // following plain text.
  const allKeys = new Set<string>()
  for (const seg of segs) {
    if (seg.attrs) for (const k of Object.keys(seg.attrs)) allKeys.add(k)
  }

  const text = new Y.XmlText()
  let pos = 0
  let wrote = false
  for (const seg of segs) {
    if (!seg.text) continue
    const attrs: Record<string, unknown> = {}
    for (const k of allKeys) attrs[k] = seg.attrs?.[k] ?? null
    // Detached Y.XmlText buffers inserts; `.length` stays 0 until it's
    // attached to a parent, so track whether we wrote anything ourselves.
    text.insert(pos, seg.text, attrs)
    pos += seg.text.length
    wrote = true
  }
  if (wrote) el.insert(0, [text])
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
}

/** marked HTML-escapes inline text; undo it so the Yjs text holds raw chars. */
function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m)
}
