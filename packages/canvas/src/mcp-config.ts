// The local stdio MCP configuration that Agent access offers to copy. `canvasDir` is
// this package's absolute directory on the machine running the dev server.

export function localMcpConfig(canvasDir: string, sessionId: string) {
  const dir = canvasDir.replace(/\/+$/, "");
  return {
    mcpServers: {
      paired: {
        command: "node",
        args: [`${dir}/node_modules/tsx/dist/cli.mjs`, `${dir}/tools/mcp.ts`],
        env: { PAIRED_SESSION: sessionId },
      },
    },
  };
}
