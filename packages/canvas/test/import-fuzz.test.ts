import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTLStore, defaultBindingUtils, defaultShapeUtils } from "tldraw";
import { CardShapeUtil } from "../src/card-shape";
import { checkStructure, maxImportBytes, parseCanvasFile } from "../src/import-file";

// Property: whatever bytes a person imports, parseCanvasFile never throws, and when
// it accepts a file the result loads into a fresh store with every record valid,
// at least one page, no orphaned shapes and no dangling connections.

const utils = { shapeUtils: [...defaultShapeUtils, CardShapeUtil], bindingUtils: defaultBindingUtils };
const schema = createTLStore(utils).schema;
const welcome = readFileSync(new URL("./fixtures/welcome.canvas.json", import.meta.url), "utf8");
type Rec = Record<string, unknown> & { id: string; typeName: string };
type File = { tldrawFileFormatVersion: unknown; schema: Record<string, unknown>; records: Rec[] };
const base = (): File => JSON.parse(welcome);

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const reasons = new Map<string, number>();
function assertLoads(json: string) {
  const result = parseCanvasFile(json, schema);
  if (!result.ok) {
    expect(typeof result.reason).toBe("string");
    const key = result.reason.replace(/(shape|binding):\S+/g, "<id>");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
    return false;
  }
  const store = createTLStore(utils);
  store.loadStoreSnapshot(result.snapshot); // throws if any record is invalid
  const records = store.allRecords() as unknown as Rec[];
  expect(checkStructure(records as never)).toBeUndefined();
  return true;
}

describe("import validation", () => {
  it("accepts a real exported board unchanged", () => {
    const result = parseCanvasFile(welcome, schema);
    expect(result.ok).toBe(true);
    expect(assertLoads(welcome)).toBe(true);
  });

  it("rejects non-canvas input with a reason instead of throwing", () => {
    for (const input of ["", "   ", "null", "1", "[]", "{}", '"text"', "{", welcome.slice(0, welcome.length / 2), "\u0000￿", "<html></html>"]) {
      const result = parseCanvasFile(input, schema);
      expect(result.ok, input.slice(0, 20)).toBe(false);
    }
  });

  it("rejects files that are too large, too new, or structurally broken", () => {
    expect(parseCanvasFile("{" + " ".repeat(maxImportBytes), schema)).toEqual({ ok: false, reason: "The file is larger than 50 MB" });
    const newer = base();
    newer.tldrawFileFormatVersion = 99;
    expect(parseCanvasFile(JSON.stringify(newer), schema)).toMatchObject({ ok: false, reason: expect.stringMatching(/newer version/) });
    const orphan = base();
    const shape = orphan.records.find((r) => r.typeName === "shape")!;
    shape.parentId = "shape:doesNotExist";
    expect(parseCanvasFile(JSON.stringify(orphan), schema)).toMatchObject({ ok: false, reason: expect.stringMatching(/missing page or frame/) });
    const dangling = base();
    const binding = dangling.records.find((r) => r.typeName === "binding")!;
    dangling.records = dangling.records.filter((r) => r.id !== binding.toId);
    expect(parseCanvasFile(JSON.stringify(dangling), schema)).toMatchObject({ ok: false });
    const pageless = base();
    pageless.records = pageless.records.filter((r) => r.typeName !== "page" && r.typeName !== "shape" && r.typeName !== "binding");
    // tldraw adds a default page to an empty board, which is a valid (empty) import.
    expect(assertLoads(JSON.stringify(pageless))).toBe(true);
  });

  it("never throws and never accepts a broken board across 600 seeded mutations", () => {
    const random = mulberry32(2026);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)];
    const values = [null, -1, 0, 1e308, -1e308, "", "x".repeat(5000), {}, [], true, "shape:ghost", "page:ghost", { __proto__: { polluted: true } }, [1, [2, [3]]]];
    const mutations: ((f: File) => void)[] = [
      (f) => { const r = pick(f.records); const k = pick(Object.keys(r)); if (k !== "id") r[k] = pick(values); },
      (f) => { const r = pick(f.records); const k = pick(Object.keys(r)); if (k !== "id") delete r[k]; },
      (f) => { const r = pick(f.records.filter((r) => r.props)); if (r) { const p = r.props as Record<string, unknown>; p[pick(Object.keys(p)) ?? "w"] = pick(values); } },
      (f) => { const r = pick(f.records.filter((r) => r.props)); if (r) { const p = r.props as Record<string, unknown>; delete p[pick(Object.keys(p))]; } },
      (f) => { f.records.splice(Math.floor(random() * f.records.length), 1); },
      (f) => { const r = pick(f.records); f.records.push({ ...structuredClone(r), id: `${r.typeName}:copy${Math.floor(random() * 1e6)}` }); },
      (f) => { const r = pick(f.records); f.records.push(structuredClone(r)); }, // duplicate ID
      (f) => { const r = pick(f.records.filter((r) => r.typeName === "shape")); if (r) r.parentId = pick(f.records).id; }, // reparent anywhere, maybe to itself
      (f) => { const r = pick(f.records.filter((r) => r.typeName === "binding")); if (r) r[pick(["fromId", "toId"])] = pick(["shape:ghost", pick(f.records).id]); },
      (f) => { const r = pick(f.records); r.typeName = pick(["shape", "page", "binding", "asset", "evil", ""]); },
      (f) => { const r = pick(f.records.filter((r) => r.typeName === "shape")); if (r) r.type = pick(["geo", "card", "chart", "script", "frame"]); },
      (f) => { f.schema = { ...f.schema, schemaVersion: pick([0, 1, 2, 3, 99, "2", null]) }; },
      (f) => { const seq = f.schema.sequences as Record<string, number> | undefined; if (seq) seq[pick(Object.keys(seq))] = pick([0, 999, -1]); },
      (f) => { f.tldrawFileFormatVersion = pick([0, 1, 2, "1", null]); },
      (f) => { (f as unknown as Record<string, unknown>).records = pick([null, {}, "records", [null], [1, 2]]); },
    ];
    reasons.clear();
    let accepted = 0, rejected = 0;
    for (let i = 0; i < 600; i++) {
      const file = base();
      const steps = 1 + Math.floor(random() * 3);
      for (let s = 0; s < steps; s++) {
        try { pick(mutations)(file); } catch { /* a mutation that cannot apply leaves the file as is */ }
      }
      let json = JSON.stringify(file);
      if (random() < 0.05) json = json.slice(0, Math.floor(random() * json.length)); // truncated download
      let ok = false;
      expect(() => { ok = assertLoads(json); }, `case ${i}`).not.toThrow();
      if (ok) accepted++;
      else rejected++;
    }
    // Both outcomes occur: harmless mutations still import; harmful ones are refused.
    expect(accepted).toBeGreaterThan(20);
    expect(rejected).toBeGreaterThan(100);
    console.info(`import fuzz: ${accepted} accepted, ${rejected} rejected`, Object.fromEntries(reasons));
  });
});
