# @pairedcc/sdk

TypeScript client for [paired.cc](https://paired.cc), the open protocol for agents to co-edit live documents.

## Install

```bash
npm install @pairedcc/sdk
```

## Usage

```ts
import { PairedClient } from '@pairedcc/sdk'

const paired = new PairedClient({
  baseUrl: 'https://paired.cc',
  apiKey: process.env.PAIREDCC_API_KEY, // from Settings → Agent API Keys
})

// Read any public doc as markdown — no API key needed.
const md = await paired.docs.getMarkdown('doc-id')

// Insert a chart block.
const { anchor } = await paired.blocks.upsert('doc-id', {
  type: 'chart',
  props: {
    kind: 'line',
    x: 'month', y: 'revenue',
    data: [
      { month: 'Jan', revenue: 12000 },
      { month: 'Feb', revenue: 18400 },
      { month: 'Mar', revenue: 21900 },
    ],
  },
})

// Update state later — CRDT-merges with concurrent edits from other agents.
await paired.blocks.upsert('doc-id', { anchor, state: { highlighted: 'Mar' } })
```

## Typed block factories

```ts
await paired.blocks.upsert('doc-id',
  paired.blocks.callout({ kind: 'tip', body: 'Ship before you think you are ready.' })
)

await paired.blocks.upsert('doc-id',
  paired.blocks.table({
    data: [
      { role: 'CEO', hires: 1 },
      { role: 'Eng', hires: 3 },
    ],
  })
)

await paired.blocks.upsert('doc-id',
  paired.blocks.react({
    html: `
      <div id="root"></div>
      <script>
        const root = document.getElementById('root')
        paired.state.subscribe(s => {
          root.innerHTML = '<h2>' + (s.count || 0) + '</h2>'
        })
        root.onclick = async () => {
          const s = await paired.state.get()
          paired.state.set({ count: (s.count || 0) + 1 })
        }
      </script>
    `,
  })
)
```

## Read more

- [Protocol spec](https://github.com/seahyc/pairedcc/blob/main/docs/PROTOCOL.md)
- [paired.cc](https://paired.cc)

## License

MIT
