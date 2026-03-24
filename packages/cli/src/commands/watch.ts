import { PairedClient } from '../client.js'

export async function watchCommand(docId: string, opts: { key: string; url: string }) {
  const client = new PairedClient(opts.url, opts.key)
  console.log(`Watching for @-mentions in document ${docId}...`)

  setInterval(async () => {
    const mentions = await client.getMentions(docId)
    for (const m of mentions) {
      console.log(`@${m.agentName}: ${m.context}`)
    }
  }, 5000)
}
