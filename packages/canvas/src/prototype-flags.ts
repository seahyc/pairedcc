// Prototypes are off unless the tab was opened with their flag (?prototype=data,
// ?prototype=learning). The flag hides their buttons and, here, refuses the agent operations
// that would put a prototype object on the board, so a default board never gains one.
// Their shapes stay registered so saved boards that contain them still load.

export type Prototype = "data" | "learning";

export const PROTOTYPE_OPS: Record<string, Prototype> = {
  dataset: "data",
  chart: "data",
  chart_state: "data",
  cell: "data",
  learn: "learning",
};

const TOOL: Record<string, string> = { dataset: "canvas_dataset", chart: "canvas_chart", chart_state: "canvas_chart_state", cell: "canvas_cell", learn: "canvas_learn" };

export function prototypeEnabled(name: Prototype, search = typeof location === "undefined" ? "" : location.search) {
  return new URLSearchParams(search).getAll("prototype").includes(name);
}

/** Why this tab refuses an operation, or null when it may run. */
export function prototypeRefusal(op: string, search = typeof location === "undefined" ? "" : location.search): string | null {
  const name = PROTOTYPE_OPS[op];
  if (!name || prototypeEnabled(name, search)) return null;
  return `${TOOL[op]} is part of the ${name} prototype, which is off in this tab. Nothing was changed. The person can turn it on by opening the canvas with ?prototype=${name}.`;
}
