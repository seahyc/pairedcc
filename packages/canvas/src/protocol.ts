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
    .default("derived-from"),
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
    "feedback",
    "reply",
    "learn",
    "overview",
    "runs",
    "undo_run",
    "dataset",
    "chart",
    "chart_state",
    "cell",
  ]),
  input: z.record(z.string(), z.unknown()).optional(),
});
export const envelopeSchema = z.object({
  sessionId: z.string().max(100).optional(),
  requestId: z.string().min(1).max(100),
  actor: z.string().min(1).max(100).default("External agent"),
  command: commandSchema,
});
export const clientHelloSchema = z.object({
  sessionId: z.string().min(1).max(100),
  title: z.string().max(200),
});
export const responseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.string(), ok: z.literal(false), error: z.string() }),
]);
export type CanvasCommand = z.infer<typeof commandSchema>;
export type CommandEnvelope = z.infer<typeof envelopeSchema>;
export type CommandResponse = z.infer<typeof responseSchema>;
