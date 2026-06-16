import { describe, it, expect } from 'vitest'
import { tools } from '../src/tools.js'

describe('MCP tools', () => {
  it('defines all 7 tools', () => {
    expect(tools).toHaveLength(7)
    const names = tools.map(t => t.name)
    expect(names).toContain('list_documents')
    expect(names).toContain('create_document')
    expect(names).toContain('read_document')
    expect(names).toContain('edit_document')
    expect(names).toContain('get_mentions')
    expect(names).toContain('respond_to_mention')
    expect(names).toContain('get_presence')
  })

  it('create_document requires markdown', () => {
    const create = tools.find(t => t.name === 'create_document')!
    expect(create.inputSchema.required).toContain('markdown')
    expect(create.inputSchema.properties).toHaveProperty('title')
  })

  it('edit_document requires doc_id, anchor, and new_content', () => {
    const edit = tools.find(t => t.name === 'edit_document')!
    expect(edit.inputSchema.required).toContain('doc_id')
    expect(edit.inputSchema.required).toContain('anchor')
    expect(edit.inputSchema.required).toContain('new_content')
  })
})
