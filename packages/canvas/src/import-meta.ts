import { z } from "zod";
import type { TLShape } from "tldraw";
import { tableText } from "./import-parse";

// Where an imported object came from. Stored on the object as `meta.source`, so the board,
// the ask context and agents can all tell source material from the person's or an agent's work.

const chip = z.object({ label: z.string(), level: z.number().nullable() });
const sourceMeta = z.object({
  importId: z.string(),
  /** File name, or "pasted", or the name an agent gave. */
  from: z.string(),
  /** When it was imported, ISO 8601. */
  at: z.string(),
  kind: z.enum(["record", "title", "field", "header", "legend", "section", "table", "image"]),
  /** Position in the import, for stepping through it in order. */
  order: z.number().optional(),
  /** 1-based data row in the source. */
  row: z.number().optional(),
  column: z.string().optional(),
  /** Every non-empty cell of the record's row, by column name. */
  values: z.record(z.string(), z.string()).optional(),
  chips: z.array(chip).optional(),
  level: z.number().nullable().optional(),
  /** Columns left empty in the source for the person's own verdict. */
  verdictColumns: z.array(z.string()).optional(),
});
export type SourceMeta = z.infer<typeof sourceMeta>;
export type SourceChip = z.infer<typeof chip>;

export function sourceOf(shape: TLShape | undefined): SourceMeta | undefined {
  if (!shape?.meta.source) return undefined;
  const parsed = sourceMeta.safeParse(shape.meta.source);
  return parsed.success ? parsed.data : undefined;
}

/** "Imported source (review.csv, row 3)": who an imported object is by, for an agent. */
export function sourceAuthor(source: SourceMeta) {
  return `Imported source (${source.from}${source.row ? `, row ${source.row}` : ""})`;
}

/**
 * What an imported object says, with its column names, as an agent should read it.
 * `plain` is the object's current text, so edits made on the board are what is sent.
 */
export function sourceText(shape: TLShape, plain: string): string | undefined {
  const source = sourceOf(shape);
  if (!source) return undefined;
  if (source.kind === "field" && source.column) {
    const value = plain.startsWith(source.column) ? plain.slice(source.column.length).trim() : plain;
    return `${source.column}: ${value}`;
  }
  if ((source.kind === "title" || source.kind === "record") && source.values) {
    const short = Object.entries(source.values).filter(([, value]) => value.length < 50);
    // The column names help an agent while the title is as imported. Once the person edits it,
    // what the board shows is what the agent gets.
    // The card's name is its title line as imported, so it tells an edited title from an untouched one.
    const flat = (t: string) => t.replace(/\s+/g, " ").trim();
    const original = flat(String(shape.meta.name ?? ""));
    const unedited = !plain || !original || flat(plain).startsWith(original);
    return unedited ? short.map(([column, value]) => `${column}: ${value}`).join(" · ") || plain : plain;
  }
  if (source.kind === "table" && shape.type === "datatable") {
    const props = shape.props as { title: string; columns: string[]; rows: string[][] };
    return `${props.title ? `${props.title}\n` : ""}${tableText(props)}`;
  }
  return undefined;
}
