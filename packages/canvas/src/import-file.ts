import { parseTldrawJsonFile, type TLSchema, type TLStoreSnapshot } from "tldraw";

// Import validation for canvas files. tldraw validates each record against the
// schema and migrates old versions; on top of that we reject files that would
// load into a broken board: oversized input, shapes whose parent is missing, and
// bindings that point at shapes that are not there.

export const maxImportBytes = 50 * 1024 * 1024;

export type ImportResult = { ok: true; snapshot: TLStoreSnapshot; records: number } | { ok: false; reason: string };

type Rec = { id: string; typeName: string; parentId?: string; fromId?: string; toId?: string };

export function checkStructure(records: readonly Rec[]): string | undefined {
  const ids = new Set(records.map((r) => r.id));
  if (!records.some((r) => r.typeName === "page")) return "The file has no pages";
  for (const r of records) {
    if (r.typeName === "shape" && (!r.parentId || !ids.has(r.parentId))) return `Shape ${r.id} belongs to a missing page or frame`;
    if (r.typeName === "binding" && (!r.fromId || !r.toId || !ids.has(r.fromId) || !ids.has(r.toId)))
      return `Connection ${r.id} points at a missing object`;
  }
  return undefined;
}

export function parseCanvasFile(json: string, schema: TLSchema): ImportResult {
  if (typeof json !== "string" || !json.trim()) return { ok: false, reason: "The file is empty" };
  if (json.length > maxImportBytes) return { ok: false, reason: "The file is larger than 50 MB" };
  try {
    const result = parseTldrawJsonFile({ json, schema });
    if (!result.ok) {
      const type = result.error.type;
      return {
        ok: false,
        reason:
          type === "notATldrawFile" ? "That is not a Paired canvas file"
          : type === "fileFormatVersionTooNew" ? "The file was made by a newer version of Paired"
          : type === "migrationFailed" ? "The file is from a version that cannot be upgraded"
          : "The file contains invalid objects",
      };
    }
    const snapshot = result.value.getStoreSnapshot();
    const records = Object.values(snapshot.store) as unknown as Rec[];
    const problem = checkStructure(records);
    if (problem) return { ok: false, reason: problem };
    return { ok: true, snapshot, records: records.length };
  } catch {
    return { ok: false, reason: "The file contains invalid objects" };
  }
}
