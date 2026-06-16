import { type Tool } from '@modelcontextprotocol/sdk/types.js'

export const tools: Tool[] = [
  {
    name: 'list_documents',
    description: 'List all documents you have access to on paired.cc',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_document',
    description:
      'Create a new paired.cc document from a markdown blob in one call. The markdown is rendered as real editable blocks (headings, lists, code, tables), not a code block. Returns the document id and a shareable web URL you can hand to a human to co-edit live.',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Full markdown content for the new document' },
        title: { type: 'string', description: 'Optional title (defaults to the first heading)' },
      },
      required: ['markdown'],
    },
  },
  {
    name: 'read_document',
    description: 'Read the full markdown content of a document',
    inputSchema: {
      type: 'object',
      properties: { doc_id: { type: 'string', description: 'Document ID' } },
      required: ['doc_id'],
    },
  },
  {
    name: 'edit_document',
    description: 'Edit a document. Anchor is a heading or text to find; new_content replaces it.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_id: { type: 'string' },
        anchor: { type: 'string', description: 'Text to find and replace (heading or content)' },
        new_content: { type: 'string', description: 'New content to replace the anchor with' },
      },
      required: ['doc_id', 'anchor', 'new_content'],
    },
  },
  {
    name: 'get_mentions',
    description: 'Get unread @-mentions for this agent in a document',
    inputSchema: {
      type: 'object',
      properties: { doc_id: { type: 'string' } },
      required: ['doc_id'],
    },
  },
  {
    name: 'respond_to_mention',
    description: 'Respond to an @-mention inline in the document',
    inputSchema: {
      type: 'object',
      properties: {
        doc_id: { type: 'string' },
        mention_id: { type: 'string' },
        content: { type: 'string', description: 'Response text to insert' },
      },
      required: ['doc_id', 'mention_id', 'content'],
    },
  },
  {
    name: 'get_presence',
    description: 'See who is currently in a document (humans and agents)',
    inputSchema: {
      type: 'object',
      properties: { doc_id: { type: 'string' } },
      required: ['doc_id'],
    },
  },
]
