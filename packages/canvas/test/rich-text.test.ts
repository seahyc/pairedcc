import { describe, expect, it } from "vitest";
import { z } from "zod";
import { richTextPlain } from "../src/operations";

// The previous zod-based implementation, kept as the reference for behaviour.
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
    { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] },
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
});
