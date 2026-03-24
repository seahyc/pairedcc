import WebSocket from 'ws'
import * as Y from 'yjs'

export async function joinCommand(docId: string, opts: { key: string; url: string }) {
  const wsUrl = opts.url.replace('http', 'ws') + `/ws/${docId}`
  const doc = new Y.Doc()
  const ws = new WebSocket(wsUrl)

  ws.on('open', () => console.log(`Connected to document ${docId}`))
  ws.on('message', (data: Buffer) => {
    Y.applyUpdate(doc, new Uint8Array(data))
    console.log('Document updated. Current length:', doc.getText('content').toString().length)
  })
  ws.on('close', () => { console.log('Disconnected'); process.exit(0) })
  ws.on('error', (err) => { console.error('Error:', err.message); process.exit(1) })

  process.on('SIGINT', () => { ws.close(); process.exit(0) })
}
