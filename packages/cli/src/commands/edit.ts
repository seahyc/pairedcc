import { PairedClient } from '../client.js'

export async function editCommand(docId: string, anchor: string, content: string, opts: { key: string; url: string }) {
  const client = new PairedClient(opts.url, opts.key)
  const result = await client.editDocument(docId, anchor, content)
  console.log(result.ok ? 'Edit applied.' : `Error: ${result.error}`)
}
