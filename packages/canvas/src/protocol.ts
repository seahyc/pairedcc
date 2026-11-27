import { z } from "zod";

const shapeId = z.string().startsWith("shape:");
const position = { x: z.number().finite(), y: z.number().finite() };
export const imageInput = z.object({
  ...position,
  src: z
    .string()
    .max(6_000_000)
    .refine(
      (s) =>
        /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(
          s,
        ),
      "Provide a base64 image data URL",
    ),
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
  name: z.string().max(200).default("Image"),
  sourceUrl: z.url().optional(),
  isAnimated: z.boolean().default(false),
  caption: z.string().max(300).optional(),
});
export const annotationInput = z.object({
  targetId: shapeId,
  text: z.string().min(1).max(10000),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  author: z.string().max(100).default("Human"),
});
export const connectionInput = z.object({
  fromId: shapeId,
  toId: shapeId,
  relation: z
    .enum(["reference", "alternative", "derived-from", "feedback"])
    .default("derived-from")
    .describe(
      "What the arrow means. reference: one supports, cites or is evidence for the other (use it for 'supports', with a label); alternative: both are options for the same thing; derived-from (the default): one was made from the other, drawn from the source to what was made; feedback: a comment on the other.",
    ),
  label: z.string().max(200).default(""),
});
export const resolveInput = z.object({
  id: shapeId,
  expectedRevision: z.number().int().nonnegative(),
  status: z.enum(["open", "resolved"]),
});
export const feedbackInput = z.object({
  status: z.enum(["open", "resolved", "all"]).default("all").describe("Which items to return."),
  allPages: z.boolean().default(true).describe("Every page of the board (default) or only the open page."),
  format: z.enum(["json", "markdown"]).default("json").describe("markdown adds a readable `markdown` summary beside the items."),
});
export const replyInput = z.object({
  id: shapeId.describe("Feedback item id from canvas_feedback."),
  text: z.string().min(1).max(10000),
});
export const askStates = ["waiting", "working", "answered", "failed"] as const;
export type AskState = (typeof askStates)[number];
export const asksInput = z.object({
  state: z.enum([...askStates, "all"]).default("waiting").describe("Which asks to return. Waiting asks are the ones nobody has picked up yet."),
  page: z.enum(["all", "current"]).default("all").describe("all (default): asks on every page, each with pageName. current: only the page open in the tab."),
});
export const askStatusInput = z.object({
  id: shapeId.describe("Ask id from canvas_asks."),
  state: z.enum(["working", "failed", "waiting"]).describe("working when you start, failed if you cannot answer, waiting to hand it back."),
  note: z.string().max(200).optional().describe("What you are doing, shown on the ask: 'Reading 2 cards'."),
  error: z.string().max(300).optional().describe("Why it failed, in plain words. Shown on the ask with a Retry button."),
});
/** An answer is one short step, never a finished essay: the caps are part of the contract. */
export const answerInput = z
  .object({
    id: shapeId.describe("Ask id from canvas_asks."),
    text: z.string().min(1).max(700).optional().describe("One short answer, about 60 words. One step, then stop."),
    alternatives: z.array(z.string().min(1).max(400)).min(2).max(4).optional().describe("2 to 4 short options placed side by side, when the ask is a choice."),
    question: z.boolean().default(false).describe("True when `text` is a clarifying question back to the human; the ask then stays open."),
    read: z.string().max(200).optional().describe("What you read to answer, shown on the ask."),
    dimensions: z
      .array(z.string().min(1).max(40))
      .min(2)
      .max(3)
      .optional()
      .describe("With alternatives, when the human asks to compare: 2 or 3 short things the options differ on (e.g. 'cost to us', 'time to ship'), shown as a small table under the options."),
    values: z
      .array(z.array(z.string().min(1).max(60)))
      .optional()
      .describe("With dimensions: one row per alternative, in order, each with one short value per dimension (a few words)."),
  })
  .refine((v) => Boolean(v.text) !== Boolean(v.alternatives), "Give either text or alternatives")
  .refine((v) => !v.dimensions || Boolean(v.alternatives), "dimensions compare alternatives: give alternatives too")
  .refine((v) => Boolean(v.dimensions) === Boolean(v.values), "Give dimensions and values together")
  .refine(
    (v) => !v.values || !v.dimensions || (v.values.length === (v.alternatives?.length ?? -1) && v.values.every((row) => row.length === v.dimensions!.length)),
    "values needs one row per alternative, each with one value per dimension",
  );
export const commandSchema = z.object({
  op: z.enum([
    "read",
    "get",
    "create",
    "update",
    "image",
    "connect",
    "annotate",
    "resolve",
    "remove",
    "select",
    "focus",
    "page",
    "screenshot",
    "scene",
    "arrange",
    "duplicate",
    "group",
    "feedback",
    "reply",
    "asks",
    "ask_status",
    "answer",
    "learn",
    "overview",
    "runs",
    "undo_run",
    "dataset",
    "chart",
    "chart_state",
    "cell",
    "converge",
    "import",
  ]),
  input: z.record(z.string(), z.unknown()).optional(),
});
export const envelopeSchema = z.object({
  sessionId: z.string().max(100).optional(),
  requestId: z.string().min(1).max(100),
  actor: z.string().min(1).max(100).default("External agent"),
  /** "mcp" when an MCP client (a chat agent the person talks to) sent it; absent for scripts. */
  via: z.literal("mcp").optional(),
  command: commandSchema,
});
export const clientHelloSchema = z.object({
  sessionId: z.string().min(1).max(100),
  title: z.string().max(200),
});
/** A tab announcing an ask for whichever agent is listening. The ask itself is opaque to the relay. */
export const askAnnounceSchema = z.object({
  sessionId: z.string().min(1).max(100),
  ask: z.looseObject({ id: z.string().min(1).max(100), attempt: z.number().int().nonnegative() }),
});
export const askWaitSchema = z.object({
  agent: z.string().min(1).max(100).default("Agent"),
  waitMs: z.number().int().min(0).max(30000).default(25000),
});
export const responseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.string(), ok: z.literal(false), error: z.string() }),
]);
export type CanvasCommand = z.infer<typeof commandSchema>;
export type CommandEnvelope = z.infer<typeof envelopeSchema>;
export type CommandResponse = z.infer<typeof responseSchema>;
