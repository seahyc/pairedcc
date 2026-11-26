import { z } from "zod";

// PROTOTYPE learning prompts (working spec, "What produces understanding": predict
// then check; generate and self-explain). Opt-in only, never blocking: every prompt
// can be skipped in one action, and the hidden result is then shown directly.

export const promptModes = ["predict", "generate"] as const;
export type PromptMode = (typeof promptModes)[number];
export type PromptStatus = "open" | "committed" | "skipped";
export type PromptProps = { w: number; h: number; mode: PromptMode; question: string; response: string; status: PromptStatus };

export const learnInput = z.object({
  mode: z.enum(promptModes).describe("predict: the person guesses before seeing a result. generate: the person explains in their own words before seeing yours."),
  question: z.string().min(1).max(1000),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(200).max(1200).default(340),
  hideIds: z
    .array(z.string().startsWith("shape:"))
    .max(50)
    .default([])
    .describe("Objects to keep hidden until the person commits or skips: the result to predict, or your explanation."),
});

export const modeCopy: Record<PromptMode, { label: string; field: string; commit: string; committed: string }> = {
  predict: { label: "Predict, then check", field: "What do you expect?", commit: "Commit my guess", committed: "You expected" },
  generate: { label: "Your explanation first", field: "Explain it in your own words", commit: "Show me how it compares", committed: "You explained" },
};

export function commitResponse(props: PromptProps, text: string): PromptProps {
  if (props.status !== "open") throw new Error("This prompt has already been answered");
  const response = text.trim();
  if (!response) throw new Error("Write something first, or skip");
  if (response.length > 2000) throw new Error("Keep it under 2,000 characters");
  return { ...props, response, status: "committed" };
}

export function skipPrompt(props: PromptProps): PromptProps {
  if (props.status !== "open") throw new Error("This prompt has already been answered");
  return { ...props, status: "skipped" };
}

/** An object stays hidden while the prompt it waits on is still open. */
export function hiddenBy(meta: Record<string, unknown>, statusOf: (promptId: string) => PromptStatus | undefined) {
  const id = meta.revealAfter;
  return typeof id === "string" && statusOf(id) === "open";
}

/**
 * Why an object may not be hidden behind a prompt, or null if it may. Only an agent's own
 * output can be held back: the person's work is never hidden from them.
 */
export function hideRefusal(
  shape: { id: string; type: string; isLocked: boolean; meta: Record<string, unknown> },
  descendants: readonly { id: string; meta: Record<string, unknown> }[] = [],
) {
  if (shape.type === "prompt") return "A prompt cannot hide another prompt";
  if (shape.isLocked) return `Unlock ${shape.id} before hiding it`;
  if (!agentMade(shape.meta)) return `${shape.id} is something the person made; a prompt can hide only an agent's own output`;
  // Hiding a frame hides everything in it, so it may hold only agent work too.
  const mine = descendants.filter((d) => !agentMade(d.meta));
  if (mine.length) return `${shape.id} holds ${mine.map((d) => d.id).join(", ")}, which the person made; a prompt can hide only an agent's own output`;
  return null;
}

/** The same authorship rule as the board's (scratchbook authorOf): anything not by an agent is the person's. */
function agentMade(meta: Record<string, unknown>) {
  const author = meta.role === "annotation" && typeof meta.author === "string" ? meta.author : typeof meta.createdBy === "string" ? meta.createdBy : "Human";
  return author !== "Human";
}
