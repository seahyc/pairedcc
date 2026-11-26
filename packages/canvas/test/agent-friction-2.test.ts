import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { asksInput } from "../src/protocol";
import { manifestJson } from "../tools/tool-defs";
import { briefListing } from "../eval/brief";

// Friction reported by the fresh agent of the 26 Nov 13:03 attempt (item 77).
const tools = JSON.parse(manifestJson()).tools as { name: string; inputSchema: { properties?: Record<string, { description?: string }>; required?: string[] } }[];
const param = (tool: string, name: string) => tools.find((t) => t.name === tool)?.inputSchema.properties?.[name];
const api = readFileSync(new URL("../AGENT_API.md", import.meta.url), "utf8");

describe("agent friction, second attempt", () => {
  it("lists tools briefly: one line each, optional parameters marked", () => {
    expect(briefListing([{ name: "canvas_x", inputSchema: { properties: { id: {}, note: {} }, required: ["id"] } }, { name: "canvas_y", inputSchema: {} }])).toBe("canvas_x(id, note?)\ncanvas_y()");
  });
  it("canvas_asks can be limited to the open page, and lists every page by default", () => {
    expect(asksInput.parse({}).page).toBe("all");
    expect(asksInput.parse({ page: "current" }).page).toBe("current");
    expect(param("canvas_asks", "page")?.description).toMatch(/current/);
  });
  it("AGENT_API names canvas_overview's children and locked fields", () => {
    expect(api).toMatch(/`children` \(how many objects it holds/);
    expect(api).toMatch(/`locked: true` \(present only when/);
  });
  it("canvas_duplicate's schema says where the copy goes by default", () => {
    expect(param("canvas_duplicate", "offsetX")?.description).toMatch(/width plus 40/);
    expect(param("canvas_duplicate", "offsetY")?.description).toMatch(/Default 0/);
  });
  it("canvas_connect's schema says what each relation means, and which one is 'supports'", () => {
    const d = param("canvas_connect", "relation")?.description ?? "";
    for (const kind of ["reference", "alternative", "derived-from", "feedback"]) expect(d).toContain(`${kind}`);
    expect(d).toMatch(/reference: one supports/);
  });
  it("AGENT_API says a reply leaves the item's revision alone", () => {
    expect(api).toMatch(/Replying does not change the item or its revision/);
  });
});
