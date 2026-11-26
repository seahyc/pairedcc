import { describe, expect, it } from "vitest";
import { historyRows, sizeLabel, whenLabel } from "../src/history";

const now = new Date(2026, 10, 26, 12, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

describe("earlier versions list", () => {
  it("labels sizes in B, KB and MB", () => {
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(12_800)).toBe("13 KB");
    expect(sizeLabel(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
  it("labels times as today, yesterday or a date", () => {
    expect(whenLabel(at(26, 9, 5), now, "en-GB")).toBe("today 09:05");
    expect(whenLabel(at(25, 18, 40), now, "en-GB")).toBe("yesterday 18:40");
    expect(whenLabel(at(20, 8), now, "en-GB")).toBe("20 Nov 08:00");
    expect(whenLabel("not a date", now)).toBe("");
  });
  it("lists newest first and marks the newest as the board now", () => {
    const rows = historyRows(
      [
        { revision: 1, sizeBytes: 900, savedAt: at(25, 10) },
        { revision: 3, sizeBytes: 2048, savedAt: at(26, 11, 30) },
        { revision: 2, sizeBytes: 1000, savedAt: at(26, 9) },
      ],
      now,
      "en-GB",
    );
    expect(rows).toEqual([
      { revision: 3, label: "Now", detail: "Revision 3 · 2 KB", current: true },
      { revision: 2, label: "today 09:00", detail: "Revision 2 · 1000 B", current: false },
      { revision: 1, label: "yesterday 10:00", detail: "Revision 1 · 900 B", current: false },
    ]);
  });
});
