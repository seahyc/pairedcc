import { Hono } from 'hono'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { authenticateAccessToken, mcpResource } from '../oauth/routes.js'
import type { CanvasRelay } from './relay.js'
import manifest from './tool-manifest.json' with { type: 'json' }

// Hosted MCP endpoint: https://paired.cc/mcp. Stateless Streamable HTTP; every
// request carries an OAuth access token, and tool calls go to the user's open
// canvas tab through the relay. Tool schemas come from the canvas package
// (tools/tool-defs.ts), and the canvas validates every command again.

type Tool = { name: string; description: string; op: string | null; output: 'json' | 'image'; inputSchema: Record<string, unknown> }
const tools = manifest.tools as Tool[]

const text = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
const failure = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] })

export function buildMcpServer(relay: CanvasRelay, who: { userId: string; agent: string }) {
  const server = new Server({ name: 'paired-canvas', version: '0.2.0' }, { capabilities: { tools: {} }, instructions: manifest.instructions })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: inputSchema as { type: 'object' } })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = tools.find((t) => t.name === request.params.name)
    if (!tool) return failure(`Unknown tool ${request.params.name}`)
    if (!tool.op) return text({ sessions: relay.list(who.userId), apiVersion: 1 })
    const { sessionId, ...input } = (request.params.arguments ?? {}) as { sessionId?: unknown } & Record<string, unknown>
    const result = await relay.send(who.userId, { op: tool.op, input }, who.agent, typeof sessionId === 'string' ? sessionId : undefined)
    if (!result.ok) return failure(result.error)
    if (tool.output === 'image') {
      const image = result.result as { data?: unknown; mimeType?: unknown }
      if (typeof image?.data !== 'string' || image.mimeType !== 'image/png') return failure('Canvas returned no image')
      return { content: [{ type: 'image', data: image.data, mimeType: 'image/png' }] }
    }
    return text(result.result)
  })
  return server
}

export function createMcpRoutes(relay: CanvasRelay) {
  const app = new Hono()
  const challenge = () =>
    `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', mcpResource()).toString()}"`

  app.options('/mcp', (c) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID')
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    c.header('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id')
    return c.body(null, 204)
  })

  app.all('/mcp', async (c) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id')
    const header = c.req.header('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const who = token ? await authenticateAccessToken(token) : null
    if (!who) {
      c.header('WWW-Authenticate', challenge())
      return c.json({ error: 'invalid_token', error_description: 'Sign in to Paired to use this server' }, 401)
    }
    if (c.req.method !== 'POST')
      return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server is stateless; use POST' }, id: null }, 405)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    const server = buildMcpServer(relay, who)
    await server.connect(transport)
    const response = await transport.handleRequest(c.req.raw)
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id')
    return new Response(response.body, { status: response.status, headers })
  })
  return app
}
