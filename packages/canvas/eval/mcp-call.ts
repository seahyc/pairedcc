import { appendFileSync, readFileSync } from "node:fs";
import { mcpAgent } from "./lib";

// Command-line MCP client for agent-usability attempts. The agent under test calls tools
// only through this: it connects to the task's tab with the real stdio MCP server and
// counts every call. The task runner writes the connection details to <dir>/current.json.
//   tsx eval/mcp-call.ts list                   tool names, descriptions and input schemas
//   tsx eval/mcp-call.ts <tool> '<json args>'   call one tool; prints its JSON result

const dir = process.env.AGENT_TASK_DIR ?? `${process.cwd()}/eval/agent-runs/work`;
const current = JSON.parse(readFileSync(`${dir}/current.json`, "utf8")) as { task: string; base: string; session: string };
const [tool, raw] = process.argv.slice(2);
if (!tool) {
  console.error("Usage: mcp-call.ts list | <tool> '<json args>'");
  process.exit(2);
}
const agent = await mcpAgent(current.base, current.session);
try {
  if (tool === "list") {
    console.log(JSON.stringify(await agent.describe(), null, 1));
  } else {
    appendFileSync(`${dir}/calls-${current.task}.log`, `${JSON.stringify({ tool, at: new Date().toISOString() })}\n`);
    const result = await agent.call(tool, raw ? JSON.parse(raw) : {});
    // Print the whole result: truncating it hands the agent broken JSON. Only image data
    // (base64) is elided, since a terminal cannot show it anyway.
    console.log(JSON.stringify(result, (key, value) => (key === "data" && typeof value === "string" && value.length > 1000 ? `<${value.length} characters of base64>` : value)));
  }
} catch (error) {
  console.log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await agent.close();
}
