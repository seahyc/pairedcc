import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { DocManager } from '../src/yjs/doc-manager.js'
import { importMarkdown } from '../src/yjs/markdown-import.js'
import { listBlocks } from '../src/yjs/blocks.js'

describe('markdown import', () => {
  it('imports headings, paragraphs and inline marks', () => {
    const m = new DocManager()
    const doc = m.getOrCreate('h-1')
    importMarkdown(doc, '# Title\n\nSome **bold** and *italic* and `code` and [a link](https://x.test).')
    const md = m.getMarkdown('h-1')
    expect(md).toContain('# Title')
    expect(md).toContain('Some **bold** and *italic* and `code` and [a link](https://x.test).')
  })

  it('imports into the "default" fragment the editor binds to', () => {
    const m = new DocManager()
    const doc = m.getOrCreate('frag-1')
    importMarkdown(doc, '# Hi')
    const frag = doc.getXmlFragment('default')
    expect(frag.length).toBeGreaterThan(0)
    expect((frag.get(0) as Y.XmlElement).nodeName).toBe('heading')
  })

  it('round-trips a representative document', () => {
    const m = new DocManager()
    const doc = m.getOrCreate('rt-1')
    const source = [
      '# Heading One',
      '',
      'A paragraph with **bold**, *italic*, ~~strike~~, `code`, and a [link](https://example.com).',
      '',
      '## Heading Two',
      '',
      '- first bullet',
      '- second bullet',
      '  - nested bullet',
      '',
      '1. first ordered',
      '2. second ordered',
      '',
      '> a block quote',
      '',
      '```ts',
      'const x: number = 1',
      'console.log(x)',
      '```',
      '',
      '| Name | Score |',
      '| --- | --- |',
      '| Ada | 99 |',
      '| Linus | 87 |',
      '',
      '---',
    ].join('\n')

    importMarkdown(doc, source)
    const out = m.getMarkdown('rt-1')

    expect(out).toContain('# Heading One')
    expect(out).toContain('## Heading Two')
    expect(out).toContain('A paragraph with **bold**, *italic*, ~~strike~~, `code`, and a [link](https://example.com).')
    expect(out).toMatch(/- first bullet/)
    expect(out).toMatch(/- second bullet/)
    expect(out).toMatch(/ {2}- nested bullet/)
    expect(out).toMatch(/1\. first ordered/)
    expect(out).toMatch(/2\. second ordered/)
    expect(out).toContain('> a block quote')
    expect(out).toContain('```ts\nconst x: number = 1\nconsole.log(x)\n```')
    expect(out).toContain('| Name | Score |')
    expect(out).toContain('| --- | --- |')
    expect(out).toContain('| Ada | 99 |')
    expect(out).toContain('| Linus | 87 |')
    expect(out).toContain('---')
  })

  it('imports task lists with checked state', () => {
    const m = new DocManager()
    const doc = m.getOrCreate('task-1')
    importMarkdown(doc, '- [ ] open task\n- [x] done task')
    const md = m.getMarkdown('task-1')
    expect(md).toContain('- [ ] open task')
    expect(md).toContain('- [x] done task')
  })

  it('round-trips a paired.cc block fence into a real pccBlock + map entry', () => {
    const m = new DocManager()
    const doc = m.getOrCreate('pcc-rt')
    const source = [
      '# Dashboard',
      '',
      '```pairedcc:chart b-rev123',
      JSON.stringify({ props: { kind: 'line' }, state: { count: 3 } }, null, 2),
      '```',
      '',
      'Trailing text.',
    ].join('\n')

    importMarkdown(doc, source)

    const blocks = listBlocks(doc)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      anchor: 'b-rev123',
      type: 'chart',
      props: { kind: 'line' },
      state: { count: 3 },
    })

    const md = m.getMarkdown('pcc-rt')
    expect(md).toContain('# Dashboard')
    expect(md).toContain('```pairedcc:chart b-rev123')
    expect(md).toContain('"kind": "line"')
    expect(md).toContain('Trailing text.')
  })

  it('replaces existing content on re-import (idempotent)', () => {
    const m = new DocManager()
    const doc = m.getOrCreate('replace-1')
    importMarkdown(doc, '# First')
    importMarkdown(doc, '# Second')
    const md = m.getMarkdown('replace-1')
    expect(md).toContain('# Second')
    expect(md).not.toContain('# First')
  })

  it('handles empty markdown without throwing', () => {
    const m = new DocManager()
    const doc = m.getOrCreate('empty-1')
    expect(() => importMarkdown(doc, '')).not.toThrow()
    expect(m.getMarkdown('empty-1')).toBe('')
  })
})
