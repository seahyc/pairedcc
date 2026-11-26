import type { Agent, Page } from "./lib";

// Shared shape of an agent-usability task (eval/tasks/*.ts). `setup` builds the starting
// board on a fresh page, acting as an earlier agent or as the person; `check` decides from
// the board alone whether the task was done; `solution` is a reference solution used only
// by the self-test to prove each check is satisfiable and fails before anyone acts.
// Agents under test see only the prompt.

export type Ctx = {
  /** MCP client acting as the setup or reference agent (not the agent under test). */
  call: Agent["call"];
  /** The person's page; `person(fn, arg)` runs fn(window.paired, editor, arg) in it. */
  page: Page;
  person<T = unknown>(fn: string, arg?: unknown): Promise<T>;
  refs: Record<string, any>;
};

export type Task = {
  id: string;
  prompt: string;
  setup?(ctx: Ctx): Promise<void>;
  /** Returns true when done, otherwise the reason it is not. */
  check(ctx: Ctx & { read: any }): Promise<true | string> | true | string;
  solution(ctx: Ctx): Promise<void>;
};

export const objs = (read: any): any[] => read.objects ?? [];
export const byText = (read: any, re: RegExp) => objs(read).filter((o) => re.test(o.text ?? ""));
export const one = (read: any, id: string) => objs(read).find((o) => o.id === id);
/** Gap between two objects' bounds in page units (negative when they overlap). */
export function gap(a: any, b: any) {
  const p = a.bounds, q = b.bounds;
  return Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w), q.y - (p.y + p.h), p.y - (q.y + q.h));
}
export const openMarks = (read: any) => (read.marks ?? []).filter((m: any) => m.status === "open");
export const task = (t: Task) => t;

/**
 * Whether a note answers "which one is highest?" with `top`. Naming only `top` answers it. A note
 * may also report the others (a fuller, comparable answer) when it names `top` first and says it
 * is the highest; a bare list of every key, or one that leads with another key, does not answer.
 */
export function answersTop(text: string, top: string, others: readonly string[]) {
  const at = (key: string) => text.search(new RegExp(`\\b${key}\\b`, "i"));
  const first = at(top);
  if (first < 0) return false;
  const rest = others.map(at).filter((i) => i >= 0);
  if (!rest.length) return true;
  return rest.every((i) => i > first) && /\b(highest|most|top|largest|biggest|leads?|greatest|max(imum)?)\b/i.test(text);
}
