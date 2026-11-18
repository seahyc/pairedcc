# Paired

Paired combines a collaborative document product with an agent-accessible thinking canvas.

- `packages/web`, `packages/server`: existing collaborative document editor and API.
- `packages/sdk`, `packages/cli`, `packages/mcp-server`: existing document integrations.
- `packages/canvas`: thinking-canvas prototype, moved from Picabird on 17 Nov 2026. See [setup](packages/canvas/README.md) and [canvas agent API](packages/canvas/AGENT_API.md).

From the repository root: `pnpm dev:canvas`, `pnpm test:canvas`, `pnpm build:canvas`, `pnpm mcp:canvas`. Existing document commands remain unchanged.

The canvas runs locally on port 5183 and is built into the production image at `/canvas/`; `/` redirects to `/canvas/`. The document editor lives under `/docs` (dashboard `/docs`, documents `/docs/d/:id`, `/docs/login`, `/docs/settings`); old `/documents`, `/d/:id`, `/login`, `/settings` and `/new` URLs 301-redirect there with their query string, so existing shared links keep working. `/api`, `/auth` and `/ws` are unchanged. The canvas still needs a production tldraw license to render. Its MCP bridge requires an open browser tab. Research and prior handoff records are in `docs/canvas/`; the archived Picabird guides there are historical, not current instructions.

## Production canvas license

The canvas bundle is deployed at `/canvas/`, but tldraw disables production rendering without a valid license. Set `VITE_TLDRAW_LICENSE_KEY` in the deployment environment and rebuild the app to enable it. The document editor remains available at `/docs` regardless. Agents connect to the hosted canvas with one command, for example `claude mcp add --transport http paired https://paired.cc/mcp`, or by being told to read https://paired.cc/agent-setup.md. They sign in through OAuth with a paired.cc account, and their commands go to the user's open, signed-in canvas tab. The Vite relay used in development stays local-only.
