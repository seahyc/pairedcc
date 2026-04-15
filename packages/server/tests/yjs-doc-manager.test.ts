import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { DocManager } from '../src/yjs/doc-manager.js'
import { upsertBlock } from '../src/yjs/blocks.js'

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
    // Tiptap stores content in an XmlFragment, not a Y.Text — mirror that here.
    const frag = doc.getXmlFragment('default')
    const para = new Y.XmlElement('paragraph')
    para.insert(0, [new Y.XmlText('Hello, world!')])
    frag.insert(0, [para])
    expect(manager.getMarkdown('doc-1')).toContain('Hello, world!')
  })

  it('serializes Tiptap-style XML fragment to markdown with marks', () => {
    const doc = manager.getOrCreate('md-1')
    const frag = doc.getXmlFragment('default')

    const heading = new Y.XmlElement('heading')
    heading.setAttribute('level', '2')
    const headingText = new Y.XmlText('Hello')
    heading.insert(0, [headingText])

    const para = new Y.XmlElement('paragraph')
    const plain = new Y.XmlText('plain ')
    const bold = new Y.XmlText()
    bold.insert(0, 'bold', { bold: true })
    const space = new Y.XmlText(' and ')
    const link = new Y.XmlText()
    link.insert(0, 'link', { link: { href: 'https://x.test' } })
    para.insert(0, [plain, bold, space, link])

    frag.insert(0, [heading, para])

    const md = manager.getMarkdown('md-1')
    expect(md).toContain('## Hello')
    expect(md).toContain('plain **bold** and [link](https://x.test)')
  })

  it('serializes nested bullet lists', () => {
    const doc = manager.getOrCreate('list-1')
    const frag = doc.getXmlFragment('default')

    const outer = new Y.XmlElement('bulletList')
    const item1 = new Y.XmlElement('listItem')
    const p1 = new Y.XmlElement('paragraph')
    p1.insert(0, [new Y.XmlText('one')])

    const inner = new Y.XmlElement('bulletList')
    const subItem = new Y.XmlElement('listItem')
    const subPara = new Y.XmlElement('paragraph')
    subPara.insert(0, [new Y.XmlText('nested')])
    subItem.insert(0, [subPara])
    inner.insert(0, [subItem])

    item1.insert(0, [p1, inner])
    outer.insert(0, [item1])
    frag.insert(0, [outer])

    const md = manager.getMarkdown('list-1')
    expect(md).toMatch(/- one/)
    expect(md).toMatch(/  - nested/)
  })

  it('serializes pccBlock as paired.cc-flavored fenced markdown', () => {
    const doc = manager.getOrCreate('pcc-1')
    const frag = doc.getXmlFragment('default')

    // Heading + a pccBlock + a paragraph after
    const h = new Y.XmlElement('heading')
    h.setAttribute('level', '1')
    h.insert(0, [new Y.XmlText('Live dashboard')])

    const block = new Y.XmlElement('pccBlock')
    block.setAttribute('anchor', 'b-revenue1')

    const trailing = new Y.XmlElement('paragraph')
    trailing.insert(0, [new Y.XmlText('See above.')])

    frag.insert(0, [h, block, trailing])

    upsertBlock(doc, 'b-revenue1', {
      type: 'duckdb',
      props: { dataset: 'sales' },
      state: { query: 'SELECT count(*) FROM orders' },
    })

    const md = manager.getMarkdown('pcc-1')
    expect(md).toContain('# Live dashboard')
    expect(md).toContain('```pairedcc:duckdb b-revenue1')
    expect(md).toContain('"props"')
    expect(md).toContain('"dataset": "sales"')
    expect(md).toContain('"query": "SELECT count(*) FROM orders"')
    expect(md).toContain('See above.')
    // Plain markdown viewers see this as a fenced code block — graceful fallback.
    expect(md.indexOf('```pairedcc:duckdb')).toBeLessThan(md.indexOf('See above.'))
  })

  it('emits stub fence for orphan pccBlock with no map entry', () => {
    const doc = manager.getOrCreate('pcc-orphan')
    const frag = doc.getXmlFragment('default')
    const block = new Y.XmlElement('pccBlock')
    block.setAttribute('anchor', 'b-orphan99')
    frag.insert(0, [block])

    const md = manager.getMarkdown('pcc-orphan')
    expect(md).toContain('```pairedcc:unknown b-orphan99')
  })

  it('serializes code blocks with language', () => {
    const doc = manager.getOrCreate('code-1')
    const frag = doc.getXmlFragment('default')
    const code = new Y.XmlElement('codeBlock')
    code.setAttribute('language', 'ts')
    code.insert(0, [new Y.XmlText('const x = 1')])
    frag.insert(0, [code])

    expect(manager.getMarkdown('code-1')).toContain('```ts\nconst x = 1\n```')
  })
})
