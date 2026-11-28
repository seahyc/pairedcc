import { describe, expect, it } from "vitest";
import { z } from "zod";
import { richTextPlain } from "../src/operations";

// The previous zod-based implementation, kept as the reference for behaviour on malformed input.
// It joined every child with a space, runs inside a paragraph included; that split a partly
// formatted word in two (item 146), so runs are no longer compared with it.
function reference(value: unknown): string {
  const parsed = z.object({ text: z.string().optional(), content: z.array(z.unknown()).optional() }).safeParse(value);
  if (!parsed.success) return "";
  if (parsed.data.text !== undefined) return parsed.data.text;
  return (parsed.data.content ?? []).map(reference).join(" ");
}

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});

describe("richTextPlain", () => {
  const cases: unknown[] = [
    doc("Hello", "world"),
    doc(),
    { text: "" },
    { text: "x", content: [{ text: "ignored" }] },
    { text: 3 },
    { content: "not an array" },
    { content: [null, 4, "s", { text: "ok" }] },
    null,
    undefined,
    "plain",
    [],
    [{ text: "array at top" }],
    {},
  ];
  it("returns exactly what the zod-based version returned", () => {
    for (const value of cases) expect(richTextPlain(value), JSON.stringify(value)).toBe(reference(value));
  });
  it("reads tldraw rich text documents", () => {
    expect(richTextPlain(doc("Hello", "world"))).toBe("Hello world");
  });
  it("keeps a partly formatted word whole (item 146)", () => {
    const bold = [{ type: "bold" }];
    const card = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lau", marks: bold }, { type: "text", text: "nch in March" }] }] };
    expect(richTextPlain(card)).toBe("Launch in March");
    const runs = { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] };
    expect(richTextPlain(runs)).toBe(" ab");
  });
  it("still separates paragraphs and hard breaks with a space", () => {
    const card = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Price:" }, { type: "hardBreak" }, { type: "text", text: "£40" }] }, { type: "paragraph", content: [{ type: "text", text: "monthly" }] }] };
    expect(richTextPlain(card)).toBe("Price: £40 monthly");
  });
});
