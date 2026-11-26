import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toolDefs } from "../tools/tool-defs";

// Keeps README.md and AGENT_API.md true to the tool definitions: a tool, operation
// or input field added without documentation fails here.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const agentApi = read("../AGENT_API.md");
const readme = read("../README.md");

/** Rows of the HTTP operations table, keyed by op, with the row's text. */
function operationRows(doc: string) {
  const rows = new Map<string, string>();
  for (const line of doc.split("\n")) {
    const m = /^\| `([a-z_]+)` \|(.*)\|$/.exec(line);
    if (m) rows.set(m[1], m[2]);
  }
  return rows;
}

describe("agent documentation", () => {
  it("names every MCP tool in AGENT_API.md", () => {
    expect(toolDefs.map((t) => t.name).filter((name) => !agentApi.includes(`\`${name}\``))).toEqual([]);
  });

  it("states the right number of tools in README.md", () => {
    const m = /The (\d+) tools/.exec(readme);
    expect(m, "README.md should say how many tools there are").not.toBeNull();
    expect(Number(m![1])).toBe(toolDefs.length);
  });

  it("has a row in the operations table for every operation", () => {
    const rows = operationRows(agentApi);
    expect(toolDefs.flatMap((t) => (t.op && !rows.has(t.op) ? [t.op] : []))).toEqual([]);
  });

  it("documents every input field of every operation", () => {
    const missing: string[] = [];
    for (const t of toolDefs)
      for (const field of Object.keys(t.input))
        if (!agentApi.includes(`\`${field}\``) && !operationRows(agentApi).get(t.op ?? "")?.includes(field))
          missing.push(`${t.name}.${field}`);
    expect(missing).toEqual([]);
  });

  it("documents the data fields that read and get return", () => {
    const fields = ["dataset", "widget", "stale", "rowCount", "rowsInView", "datasetVersion"];
    expect(fields.filter((f) => !agentApi.includes(`\`${f}\``))).toEqual([]);
  });

  it("does not point at one machine's absolute paths", () => {
    expect((readme + agentApi).match(/\/Users\/[a-z]+\/\S*/g) ?? []).toEqual([]);
  });
});
