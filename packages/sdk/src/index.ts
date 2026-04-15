/**
 * @pairedcc/sdk — TypeScript client for the paired.cc agent protocol.
 *
 * This is a thin, zero-dependency HTTP wrapper. It reads and writes docs
 * and component blocks via the paired.cc REST API. No Yjs knowledge
 * required — the server handles CRDT semantics on the agent's behalf.
 *
 * Quick start:
 *
 *   import { PairedClient } from '@pairedcc/sdk'
 *
 *   const paired = new PairedClient({
 *     baseUrl: 'https://paired.cc',
 *     apiKey: process.env.PAIREDCC_API_KEY,
 *   })
 *
 *   // Read any doc as markdown (including public docs — no key needed)
 *   const md = await paired.docs.getMarkdown('doc-id')
 *
 *   // List blocks in a doc
 *   const blocks = await paired.blocks.list('doc-id')
 *
 *   // Insert a chart block
 *   const { anchor } = await paired.blocks.upsert('doc-id', {
 *     type: 'chart',
 *     props: {
 *       kind: 'line', x: 'month', y: 'revenue',
 *       data: [{month: 'Jan', revenue: 12000}, ...],
 *     },
 *   })
 *
 *   // Update just the state of an existing block — merges with CRDT semantics.
 *   await paired.blocks.upsert('doc-id', { anchor, state: { count: 42 } })
 */

export interface PairedClientOptions {
  baseUrl: string
  /** API key from paired.cc Settings → Agent API Keys. Required for write operations. */
  apiKey?: string
  /** Custom fetch implementation (for testing or non-browser runtimes without global fetch). */
  fetch?: typeof fetch
}

export interface BlockSnapshot {
  anchor: string
  type: string
  props: unknown
  state: Record<string, unknown>
}

/** Block types that the paired.cc canvas knows how to render. Agents can
 * supply any type; unknown types fall back to a debug renderer. */
export type BlockType =
  | 'counter'
  | 'pullquote'
  | 'callout'
  | 'react'
  | 'chart'
  | 'table'
  | 'scrolly'
  | 'sql'
  | (string & {})  // allow custom types without losing autocomplete on known ones

// ---- Strongly-typed props for the built-in block types. ----

export interface ChartProps {
  kind: 'line' | 'bar' | 'area'
  data: Array<Record<string, unknown>>
  x: string
  y: string
  title?: string
  color?: string
}

export interface TableColumn {
  key: string
  label?: string
  align?: 'left' | 'right'
}

export interface TableProps {
  columns?: Array<string | TableColumn>
  data: Array<Record<string, unknown>>
  pageSize?: number
  searchable?: boolean
}

export interface ScrollyProps {
  steps: Array<{ text: string; panel: string }>
}

export interface PullquoteProps {
  text: string
  attribution?: string
}

export interface CalloutProps {
  kind: 'note' | 'warn' | 'tip'
  body: string
}

export interface ReactProps {
  /** Agent-authored HTML body. Gets wrapped in the sandbox shell. */
  html: string
}

export interface SqlProps {
  connectorId: string
  query: string
  title?: string
}

// ---- Main client ----

export class PairedClient {
  private baseUrl: string
  private apiKey: string | undefined
  private fetchImpl: typeof fetch

  constructor(opts: PairedClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.apiKey = opts.apiKey
    this.fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('No fetch available. Pass `fetch` in options for non-browser runtimes.') }) as typeof fetch)
  }

  /** Docs: read + metadata. */
  docs = {
    /**
     * Fetch the doc as plain markdown. Public and anonymous docs work
     * without auth — private docs require the API key to belong to the
     * owner or a collaborator.
     */
    getMarkdown: async (docId: string): Promise<string> => {
      return this.req<string>(`/api/documents/${docId}/raw`, { method: 'GET', expect: 'text' })
    },

    /** Fetch metadata (title, is_public, is_anonymous, owner_id, ...). */
    get: async (docId: string): Promise<DocMeta> => {
      return this.req<DocMeta>(`/api/documents/${docId}`, { method: 'GET' })
    },

    /** List docs accessible to this API key's user. */
    list: async (): Promise<DocMeta[]> => {
      return this.req<DocMeta[]>('/api/agent/documents', { method: 'GET', auth: true })
    },
  }

  /** Blocks: the paired.cc substrate primitive. */
  blocks = {
    list: async (docId: string): Promise<BlockSnapshot[]> => {
      return this.req<BlockSnapshot[]>(`/api/agent/documents/${docId}/blocks`, { method: 'GET', auth: true })
    },

    get: async (docId: string, anchor: string): Promise<BlockSnapshot> => {
      return this.req<BlockSnapshot>(`/api/agent/documents/${docId}/blocks/${anchor}`, { method: 'GET', auth: true })
    },

    /**
     * Create or update a block. If `anchor` is omitted, the server generates
     * one and returns it. Partial updates (e.g. just `state`) merge into
     * the existing entry — CRDT merges state fields across concurrent edits.
     */
    upsert: async (
      docId: string,
      body: { anchor?: string; type?: BlockType; props?: unknown; state?: Record<string, unknown> },
    ): Promise<BlockSnapshot> => {
      return this.req<BlockSnapshot>(`/api/agent/documents/${docId}/blocks/upsert`, {
        method: 'POST',
        body,
        auth: true,
      })
    },

    delete: async (docId: string, anchor: string): Promise<void> => {
      await this.req(`/api/agent/documents/${docId}/blocks/${anchor}`, {
        method: 'DELETE',
        auth: true,
      })
    },

    // ---- Typed factories — the nice autocomplete path ----

    chart: (props: ChartProps) => ({ type: 'chart' as const, props }),
    table: (props: TableProps) => ({ type: 'table' as const, props }),
    scrolly: (props: ScrollyProps) => ({ type: 'scrolly' as const, props }),
    pullquote: (props: PullquoteProps) => ({ type: 'pullquote' as const, props }),
    callout: (props: CalloutProps) => ({ type: 'callout' as const, props }),
    react: (props: ReactProps) => ({ type: 'react' as const, props }),
    sql: (props: SqlProps) => ({ type: 'sql' as const, props }),
  }

  // ---- internals ----

  private async req<T = unknown>(
    path: string,
    opts: { method: string; body?: unknown; expect?: 'json' | 'text'; auth?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.auth) {
      if (!this.apiKey) throw new Error('This call requires an API key. Pass `apiKey` to the PairedClient constructor.')
      headers['X-API-Key'] = this.apiKey
    }
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.text()).slice(0, 500) } catch {}
      throw new Error(`paired.cc ${opts.method} ${path}: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`)
    }
    if (opts.expect === 'text') return (await res.text()) as T
    return (await res.json()) as T
  }
}

export interface DocMeta {
  id: string
  title: string
  is_anonymous?: boolean
  is_public?: boolean
  owner_id?: string | null
  expires_at?: string | null
  updated_at?: string
}
