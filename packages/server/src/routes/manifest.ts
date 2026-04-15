import { Hono } from 'hono'

/**
 * GET /api/block-kit — the agent-facing block type manifest.
 *
 * Agents (Claude Code, MCP clients, the @pairedcc/sdk) call this to
 * discover which block types are available and how to use them. It's the
 * "tool description" for the paired.cc protocol: no auth required, pure
 * metadata, stable JSON schema.
 *
 * The shape is intentionally designed to fit as a system prompt fragment:
 * each entry has a terse purpose, the props shape, and one example. An
 * agent reading this should be able to produce valid `blocks.upsert`
 * calls without any further documentation.
 */

export const manifestRoutes = new Hono()

manifestRoutes.get('/', (c) => {
  return c.json({
    protocol: 'pcc-md',
    version: '0.1',
    docs: 'https://github.com/seahyc/pairedcc/blob/main/docs/PROTOCOL.md',
    sdk: '@pairedcc/sdk',
    blocks: [
      {
        type: 'chart',
        purpose: 'Line, bar, or area chart with inline data. Best for simple time-series or categorical viz.',
        props: { kind: 'line | bar | area', x: 'string (key in data)', y: 'string (key in data)', data: 'Array<Record<string, number|string>>', title: 'string?', color: 'css color?' },
        example: {
          kind: 'line',
          x: 'month', y: 'revenue',
          data: [
            { month: 'Jan', revenue: 12000 },
            { month: 'Feb', revenue: 18400 },
          ],
          title: 'Revenue 2026',
        },
      },
      {
        type: 'table',
        purpose: 'Sortable, filterable, paginated data table.',
        props: { data: 'Array<Record>', columns: 'Array<string | {key, label, align}>?', pageSize: 'number?', searchable: 'boolean?' },
        example: { data: [{ role: 'CEO', hires: 1 }, { role: 'Eng', hires: 3 }] },
      },
      {
        type: 'scrolly',
        purpose: 'Step-driven explainer with sticky visual panel. Use for multi-step walkthroughs.',
        props: { steps: 'Array<{text: string, panel: string (HTML, no scripts)}>' },
        example: {
          steps: [
            { text: 'First, the problem.', panel: '<h2>Problem</h2>' },
            { text: 'Then, the solution.', panel: '<h2>Solution</h2>' },
          ],
        },
      },
      {
        type: 'pullquote',
        purpose: 'Editorial pull-quote.',
        props: { text: 'string', attribution: 'string?' },
        example: { text: 'Ship before you think you are ready.', attribution: 'office hours' },
      },
      {
        type: 'callout',
        purpose: 'Note / warning / tip aside.',
        props: { kind: 'note | warn | tip', body: 'string' },
        example: { kind: 'tip', body: 'Use /react for fully custom behavior.' },
      },
      {
        type: 'react',
        purpose: 'Sandboxed agent-authored HTML/JS. Full control, runs in opaque-origin iframe. Use when no built-in type fits.',
        props: { html: 'string — body HTML + inline <script>. Use window.paired.{state,fetch,db,user} for I/O.' },
        example: {
          html: '<div id="app"></div><script>paired.state.subscribe(s => document.getElementById("app").textContent = s.message || "")</script>',
        },
        capabilities: {
          state: 'paired.state.get/set/subscribe — CRDT-shared across viewers',
          fetch: 'paired.fetch(url) — allowlisted hosts only',
          db: 'paired.db(connectorId, query, params?) — server-routed SQL',
          user: 'paired.user() — { signedIn, name? }',
        },
      },
      {
        type: 'sql',
        purpose: 'Live SQL query rendered as a table. Uses a granted Postgres connector. Always read-only.',
        props: { connectorId: 'string (uuid)', query: 'string', title: 'string?' },
        example: { connectorId: 'CONNECTOR_UUID', query: 'SELECT date, count(*) FROM events GROUP BY date LIMIT 30' },
        note: 'The connector must be granted to this doc by its owner. Public and anonymous docs cannot use connectors.',
      },
      {
        type: 'counter',
        purpose: 'Demo: multiplayer click counter. State holds { count }.',
        props: {},
        example: {},
      },
    ],
    themes: [
      { id: 'minimal', name: 'Minimal', description: 'Default — get out of the way.' },
      { id: 'editorial', name: 'Editorial', description: 'Serif headlines, readable column, drop caps.' },
    ],
    api: {
      docs_raw: '/api/documents/:id/raw',
      blocks_list: '/api/agent/documents/:docId/blocks',
      blocks_upsert: '/api/agent/documents/:docId/blocks/upsert',
      blocks_delete: '/api/agent/documents/:docId/blocks/:anchor',
    },
  })
})
