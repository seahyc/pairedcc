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

describe("AGENT_API.md starts with what most tasks need (item 135)", () => {
  const start = /\n## Start here\n([\s\S]*?)\n## /.exec(agentApi)?.[1] ?? "";
  const slug = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ /g, "-");
  const anchors = new Set([...agentApi.matchAll(/^#{1,4} (.+)$/gm)].map((m) => slug(m[1])));
  it("is the first section, and short", () => {
    expect(start, "AGENT_API.md should have a Start here section").not.toBe("");
    expect(/^## (.+)$/m.exec(agentApi)?.[1]).toBe("Start here");
    expect(new TextEncoder().encode(start).length).toBeLessThanOrEqual(3000);
  });
  it("names only tools that exist", () => {
    const names = new Set(toolDefs.map((t) => t.name));
    expect([...start.matchAll(/`(canvas_[a-z_]+)`/g)].map((m) => m[1]).filter((n) => !names.has(n))).toEqual([]);
  });
  it("covers the common loop", () => {
    for (const tool of ["canvas_asks", "canvas_answer", "canvas_overview", "canvas_read", "canvas_undo_run"]) expect(start).toContain(`\`${tool}\``);
  });
  it("links only to sections that exist", () => {
    const links = [...start.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    expect(links.filter((l) => !anchors.has(l))).toEqual([]);
  });
});
