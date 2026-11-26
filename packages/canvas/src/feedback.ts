// The feedback queue: every comment, pick, reject and ink mark the human has left on
// the board, across pages, with the agent's replies. One list feeds the Feedback panel,
// the agent API (`feedback` op) and the JSON/Markdown export.

export const HUMAN_AUTHOR = "Human";

export type FeedbackKind = "comment" | "pick" | "reject" | "ink";
export type FeedbackStatus = "open" | "resolved";
type Box = { x: number; y: number; w: number; h: number };

/** A board object reduced to what the queue needs, so the logic runs without an editor. */
export type FeedbackSource = {
  id: string;
  type: string;
  pageId: string;
  pageName: string;
  name: string;
  text: string;
  author: string;
  revision: number;
  meta: Record<string, unknown>;
  bounds?: Box;
  /** For human pen strokes: the objects the stroke is drawn over. */
  inkTargets?: string[];
};

export type FeedbackTarget = { id: string; type?: string; name?: string; text?: string; missing?: true };
export type FeedbackReply = { id: string; author: string; text: string; createdAt?: string };
export type FeedbackItem = {
  id: string;
  revision: number;
  kind: FeedbackKind;
  status: FeedbackStatus;
  text: string;
  author: string;
  pageId: string;
  pageName: string;
  /** Objects the mark is about. Empty for a comment pinned to a spot on the board. */
  targetIds: string[];
  targets: FeedbackTarget[];
  /** Page-space top-left of the mark, and its box when known. */
  position?: { x: number; y: number };
  bounds?: Box;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  replies: FeedbackReply[];
};

const iso = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const clip = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const round = (box: Box): Box => ({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });

function commentTargets(meta: Record<string, unknown>) {
  if (Array.isArray(meta.targetIds)) return meta.targetIds.filter((id): id is string => typeof id === "string");
  return typeof meta.targetId === "string" ? [meta.targetId] : [];
}

/** Build the queue from board objects. Open items first, then oldest first. */
export function buildFeedback(sources: FeedbackSource[]): FeedbackItem[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const items: FeedbackItem[] = [];
  const describe = (id: string): FeedbackTarget => {
    const s = byId.get(id);
    if (!s) return { id, missing: true };
    return { id, type: s.type, name: s.name, ...(s.text ? { text: clip(s.text) } : {}) };
  };
  const item = (
    s: FeedbackSource,
    kind: FeedbackKind,
    status: unknown,
    targetIds: string[],
    times: { createdAt?: unknown; updatedAt?: unknown; resolvedAt?: unknown },
  ): FeedbackItem => {
    const resolved = status === "resolved";
    return {
      id: s.id,
      revision: s.revision,
      kind,
      status: resolved ? "resolved" : "open",
      text: kind === "comment" ? s.text.trim() : "",
      author: HUMAN_AUTHOR,
      pageId: s.pageId,
      pageName: s.pageName,
      targetIds,
      targets: targetIds.map(describe),
      ...(s.bounds ? { position: { x: Math.round(s.bounds.x), y: Math.round(s.bounds.y) }, bounds: round(s.bounds) } : {}),
      createdAt: iso(times.createdAt),
      updatedAt: iso(times.updatedAt),
      ...(resolved ? { resolvedAt: iso(times.resolvedAt), resolvedBy: str(s.meta.resolvedBy) } : {}),
      replies: [],
    };
  };

  for (const s of sources) {
    const m = s.meta;
    // Picks and rejects are human judgements on any object, including agent work.
    if (m.mark === "picked" || m.mark === "rejected")
      items.push(
        item(s, m.mark === "picked" ? "pick" : "reject", m.markStatus, [s.id], {
          createdAt: m.markedAt,
          updatedAt: m.markedAt,
          resolvedAt: m.resolvedAt,
        }),
      );
    if (s.author !== HUMAN_AUTHOR) continue;
    if (m.role === "annotation")
      items.push(
        item(s, "comment", m.status, commentTargets(m), {
          createdAt: m.createdAt,
          updatedAt: m.updatedAt ?? m.createdAt,
          resolvedAt: m.resolvedAt,
        }),
      );
    else if (s.type === "draw" && s.inkTargets?.length)
      items.push(
        item(s, "ink", m.status, s.inkTargets, {
          createdAt: m.createdAt,
          updatedAt: m.createdAt,
          resolvedAt: m.resolvedAt,
        }),
      );
  }

  // An agent note attached to a mark is its reply, shown under it rather than as its own item.
  const firstById = new Map<string, FeedbackItem>();
  for (const i of items) if (!firstById.has(i.id) || i.kind === "comment") firstById.set(i.id, i);
  for (const s of sources) {
    if (s.author === HUMAN_AUTHOR || s.meta.role !== "annotation") continue;
    const explicit = str(s.meta.replyTo);
    const parent = firstById.get(explicit ?? str(s.meta.targetId) ?? "");
    if (!parent) continue;
    // Without replyTo, a note pointing at an object that happens to be picked is not a reply.
    if (!explicit && parent.kind !== "comment" && parent.kind !== "ink") continue;
    parent.replies.push({ id: s.id, author: s.author, text: s.text.trim(), createdAt: iso(s.meta.createdAt) });
  }
  for (const i of items) i.replies.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return items
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.status !== b.entry.status) return a.entry.status === "open" ? -1 : 1;
      const at = a.entry.createdAt, bt = b.entry.createdAt;
      if (at && bt && at !== bt) return at < bt ? -1 : 1;
      if (Boolean(at) !== Boolean(bt)) return at ? 1 : -1; // undated (older) marks first
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export function feedbackCounts(items: FeedbackItem[]) {
  const counts = { total: items.length, open: 0, resolved: 0, comments: 0, picks: 0, rejects: 0, ink: 0 };
  for (const i of items) {
    counts[i.status] += 1;
    counts[i.kind === "comment" ? "comments" : i.kind === "pick" ? "picks" : i.kind === "reject" ? "rejects" : "ink"] += 1;
  }
  return counts;
}

export function filterFeedback(items: FeedbackItem[], status: FeedbackStatus | "all") {
  return status === "all" ? items : items.filter((i) => i.status === status);
}

const kindLabel: Record<FeedbackKind, string> = { comment: "Comment", pick: "Picked", reject: "Rejected", ink: "Ink" };

/** One-line title for a queue row: the comment itself, or what was picked, rejected or drawn on. */
export function feedbackTitle(item: FeedbackItem) {
  if (item.kind === "comment") return item.text || "(empty comment)";
  const names = item.targets.map((t) => t.name ?? t.id).join(", ");
  return `${kindLabel[item.kind]}${item.kind === "ink" ? " over" : ":"} ${names || "the board"}`;
}

/** Where the mark sits, in words: its target objects or a spot on the board. */
export function feedbackWhere(item: FeedbackItem) {
  if (item.targets.length)
    return `on ${item.targets.map((t) => (t.missing ? `a deleted object (${t.id})` : `"${t.name}" (${t.type}, ${t.id})`)).join(", ")}`;
  return item.position ? `on the board at (${item.position.x}, ${item.position.y})` : "on the board";
}

const quote = (text: string, indent: string) => text.split("\n").map((line) => `${indent}> ${line}`).join("\n");

/** Readable export of the queue, for pasting into a chat or an issue. */
export function feedbackMarkdown(items: FeedbackItem[], opts: { title?: string; exportedAt?: Date } = {}) {
  const counts = feedbackCounts(items);
  const lines = [
    `# Feedback${opts.title ? `: ${opts.title}` : ""}`,
    "",
    `${counts.open} open, ${counts.resolved} resolved (${counts.comments} comments, ${counts.picks} picks, ${counts.rejects} rejects, ${counts.ink} ink marks).${opts.exportedAt ? ` Exported ${opts.exportedAt.toISOString()}.` : ""}`,
  ];
  for (const status of ["open", "resolved"] as const) {
    const group = filterFeedback(items, status);
    if (!group.length) continue;
    lines.push("", `## ${status === "open" ? "Open" : "Resolved"} (${group.length})`, "");
    group.forEach((i, n) => {
      const targetText = i.kind !== "comment" && i.targets[0]?.text ? `: "${clip(i.targets[0].text.replace(/\s+/g, " "), 80)}"` : "";
      lines.push(`${n + 1}. **${kindLabel[i.kind]}** ${feedbackWhere(i)}${targetText}`);
      if (i.kind === "comment") lines.push(quote(i.text || "(empty)", "   "));
      const facts = [`page "${i.pageName}"`, `by ${i.author}`, i.createdAt ? `at ${i.createdAt}` : "", `id ${i.id}`];
      if (i.status === "resolved") facts.push(`resolved${i.resolvedBy ? ` by ${i.resolvedBy}` : ""}${i.resolvedAt ? ` at ${i.resolvedAt}` : ""}`);
      lines.push(`   - ${facts.filter(Boolean).join(" · ")}`);
      for (const r of i.replies) lines.push(`   - Reply from ${r.author}: ${r.text.replace(/\s*\n\s*/g, " ")}`);
    });
  }
  if (!items.length) lines.push("", "No feedback has been left on this board.");
  return `${lines.join("\n")}\n`;
}
