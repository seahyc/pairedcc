import type { RevisionSummary } from "./board-sync";

// Pure helpers for the "Earlier versions" dialog, unit-tested in test/history.test.ts.

export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "today 11:02", "yesterday 18:40" or "24 Nov 09:15", in the viewer's time zone. */
export function whenLabel(savedAt: string, now: Date, locale?: string) {
  const at = new Date(savedAt);
  if (Number.isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return `${at.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${time}`;
}

export type HistoryRow = { revision: number; label: string; detail: string; current: boolean };

/** Rows newest first; the newest kept revision is the board as it is now. */
export function historyRows(revisions: RevisionSummary[], now: Date, locale?: string): HistoryRow[] {
  const sorted = [...revisions].sort((a, b) => b.revision - a.revision);
  return sorted.map((r, i) => ({
    revision: r.revision,
    label: i === 0 ? "Now" : whenLabel(r.savedAt, now, locale),
    detail: `Revision ${r.revision} · ${sizeLabel(r.sizeBytes)}`,
    current: i === 0,
  }));
}

/** A person-readable name for a saved board ID: "main" and browser copies get plain names. */
export function boardLabel(id: string, locale?: string) {
  if (id === "main") return "Your board";
  const copy = /^(.+)-browser-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(id);
  if (!copy) return id;
  const [, from, y, mo, d, h, mi] = copy;
  const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  const when = `${at.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  return `${from === "main" ? "Kept from a browser" : `Kept from a browser (${from})`} · ${when}`;
}
