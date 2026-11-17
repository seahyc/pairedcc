# Paired

Paired combines a collaborative document product with an agent-accessible thinking canvas.

- `packages/web`, `packages/server`: existing collaborative document editor and API.
- `packages/sdk`, `packages/cli`, `packages/mcp-server`: existing document integrations.
- `packages/canvas`: thinking-canvas prototype, moved from Picabird on 17 Nov 2026. See [setup](packages/canvas/README.md) and [canvas agent API](packages/canvas/AGENT_API.md).

From the repository root: `pnpm dev:canvas`, `pnpm test:canvas`, `pnpm build:canvas`, `pnpm mcp:canvas`. Existing document commands remain unchanged.

The canvas runs locally on port 5183 and is built into the production image at `/canvas/`; `/` currently redirects to `/documents` while the canvas awaits a production tldraw license. The original document entry is `/documents`, with existing `/d/:id` links preserved. Its MCP bridge requires an open browser tab. Research and prior handoff records are in `docs/canvas/`; the archived Picabird guides there are historical, not current instructions.

## Production canvas license

The canvas bundle is deployed at `/canvas/`, but tldraw disables production rendering without a valid license. Set `VITE_TLDRAW_LICENSE_KEY` in the deployment environment and rebuild the app to enable it. The landing page remains `/documents` until this is resolved. The canvas MCP relay remains local-only.
