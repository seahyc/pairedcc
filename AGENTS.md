# Paired agent guide

Preserve the existing document editor, server, SDK, CLI and document MCP server. The thinking canvas lives in `packages/canvas`; its working specification is `docs/canvas/working-spec.md`. Canvas code was moved from Picabird, which remains a separate shopping/data project.

Read `packages/canvas/README.md` and `AGENT_API.md` for local setup, current capabilities and limitations. Browser storage keys retain the Picabird names solely for local document compatibility. Runtime branding, MCP environment variables and transport events use Paired.

The canvas is a local prototype. Do not expose its development relay as a hosted backend. Public paired.cc integration requires a durable authenticated document/runtime design; the public static canvas lives at `/canvas/` (the domain landing page), while document links remain available. Hosted canvas agent access is not enabled.

Use the pnpm workspace scripts for canvas checks. No global MCP registration was changed. The macOS local service is `com.paired.canvas.dev`.
