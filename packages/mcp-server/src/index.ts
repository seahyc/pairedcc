import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools } from './tools.js'
import { PairedClient } from './client.js'

const server = new Server({ name: 'pairedcc', version: '0.0.1' }, { capabilities: { tools: {} } })

const client = new PairedClient(
  process.env.PAIREDCC_URL || 'https://paired.cc',
  process.env.PAIREDCC_API_KEY || '',
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  let result: any

  switch (name) {
    case 'list_documents':
      result = await client.listDocuments()
      break
    case 'read_document':
      result = await client.readDocument(args!.doc_id as string)
      break
    case 'edit_document':
      result = await client.editDocument(args!.doc_id as string, args!.anchor as string, args!.new_content as string)
      break
    case 'get_mentions':
      result = await client.getMentions(args!.doc_id as string)
      break
    case 'respond_to_mention':
      result = await client.respondToMention(args!.doc_id as string, args!.mention_id as string, args!.content as string)
      break
    case 'get_presence':
      result = await client.getPresence(args!.doc_id as string)
      break
    default:
      throw new Error(`Unknown tool: ${name}`)
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
