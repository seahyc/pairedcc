import { describe, it, expect } from 'vitest'
import { PairedClient } from '../src/index.js'

function mockFetch(responses: Array<{ match: (url: string, init?: RequestInit) => boolean; response: { status?: number; body?: unknown; text?: string } }>) {
  return (async (url: string, init?: RequestInit) => {
    const hit = responses.find(r => r.match(String(url), init))
    if (!hit) throw new Error(`unexpected fetch: ${url}`)
    const status = hit.response.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      json: async () => hit.response.body,
      text: async () => hit.response.text ?? JSON.stringify(hit.response.body ?? ''),
    } as Response
  }) as unknown as typeof fetch
}

describe('PairedClient', () => {
  it('reads markdown without auth', async () => {
    const p = new PairedClient({
      baseUrl: 'https://paired.cc',
      fetch: mockFetch([
        { match: (u) => u === 'https://paired.cc/api/documents/abc/raw', response: { text: '# Hello' } },
      ]),
    })
    const md = await p.docs.getMarkdown('abc')
    expect(md).toBe('# Hello')
  })

  it('requires api key for agent list endpoint', async () => {
    const p = new PairedClient({ baseUrl: 'https://paired.cc', fetch: mockFetch([]) })
    await expect(p.docs.list()).rejects.toThrow(/requires an API key/)
  })

  it('sends api key as X-API-Key header', async () => {
    let capturedHeaders: Record<string, string> = {}
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {}
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ([{ id: 'd1', title: 'T' }]),
        text: async () => '',
      } as Response
    }) as unknown as typeof fetch
    const p = new PairedClient({ baseUrl: 'https://paired.cc', apiKey: 'sk_test', fetch: fetchImpl })
    await p.docs.list()
    expect(capturedHeaders['X-API-Key']).toBe('sk_test')
  })

  it('typed chart factory produces correct shape', () => {
    const p = new PairedClient({ baseUrl: 'https://paired.cc' })
    const spec = p.blocks.chart({
      kind: 'line', x: 'x', y: 'y',
      data: [{ x: 1, y: 2 }],
      title: 'demo',
    })
    expect(spec.type).toBe('chart')
    expect((spec.props as { kind: string }).kind).toBe('line')
  })

  it('surfaces server errors with status + detail', async () => {
    const p = new PairedClient({
      baseUrl: 'https://paired.cc',
      apiKey: 'sk_test',
      fetch: mockFetch([
        { match: () => true, response: { status: 403, body: {}, text: 'Forbidden' } },
      ]),
    })
    await expect(p.blocks.list('doc-1')).rejects.toThrow(/403.*Forbidden/)
  })
})
