import { describe, it, expect, vi } from "vitest";
import { AskDesk, LISTENER_GRACE_MS } from "../server/asks";
import { answerLayout, askStatusLine, capWords, markOf, mergeHistory, suggestQuestion, OPTION_W } from "../src/ask-rules";
import { answerInput, askStatusInput } from "../src/protocol";
import { buildPrompt, parseReply, readingNote, systemPrompt } from "../tools/resident-prompt";
import { toolDefs } from "../tools/tool-defs";

const ask = (id: string, attempt = 0) => ({ id, attempt, question: "What's missing?" });

describe("ask desk", () => {
  it("hands a queued ask to the next agent that waits, once", async () => {
    const desk = new AskDesk();
    expect(desk.announce("tab", ask("shape:a"))).toBe(true);
    expect(desk.announce("tab", ask("shape:a"))).toBe(false);
    expect(await desk.wait("Claude", 10).promise).toEqual({ sessionId: "tab", ask: ask("shape:a") });
    expect(await desk.wait("Claude", 10).promise).toBeNull();
  });
  it("delivers straight to a waiting agent, and a retry is a new attempt", async () => {
    const desk = new AskDesk();
    const waiting = desk.wait("Claude", 1000);
    desk.announce("tab", ask("shape:a"));
    expect((await waiting.promise)?.ask.id).toBe("shape:a");
    expect(desk.announce("tab", ask("shape:a", 1))).toBe(true);
    expect((await desk.wait("Claude", 10).promise)?.ask.attempt).toBe(1);
  });
  it("gives one ask to one agent only", async () => {
    const desk = new AskDesk();
    const first = desk.wait("A", 30), second = desk.wait("B", 30);
    desk.announce("tab", ask("shape:a"));
    const got = await Promise.all([first.promise, second.promise]);
    expect(got.filter(Boolean)).toHaveLength(1);
  });
  it("tells tabs who is listening, and that nobody is once the agent has gone", async () => {
    vi.useFakeTimers();
    try {
      const seen: string[][] = [];
      const desk = new AskDesk((agents) => seen.push(agents));
      expect(desk.listeners()).toEqual([]);
      const waiting = desk.wait("Claude", 25000);
      expect(desk.listeners()).toEqual(["Claude"]);
      waiting.cancel();
      // Between two waits the agent still counts as listening.
      expect(desk.listeners()).toEqual(["Claude"]);
      await vi.advanceTimersByTimeAsync(LISTENER_GRACE_MS + 500);
      expect(desk.listeners()).toEqual([]);
      expect(seen).toEqual([["Claude"], []]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("forgets a closed tab's asks so it can announce them again", async () => {
    const desk = new AskDesk();
    desk.announce("tab", ask("shape:a"));
    desk.dropSession("tab");
    expect(await desk.wait("Claude", 5).promise).toBeNull();
    expect(desk.announce("tab", ask("shape:a"))).toBe(true);
  });
});

describe("ask rules", () => {
  it("cuts an answer that runs long", () => {
    const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    expect(capWords(long, 90).split(" ")).toHaveLength(90);
    expect(capWords(long, 90).endsWith("…")).toBe(true);
    expect(capWords("short answer", 90)).toBe("short answer");
  });
  it("puts alternatives side by side under the ask without overlapping", () => {
    const { cards, box } = answerLayout({ x: 100, y: 200 }, ["one", "two", "three"]);
    expect(cards.map((c) => c.dx)).toEqual([0, OPTION_W + 20, 2 * (OPTION_W + 20)]);
    expect(box.y).toBeGreaterThan(200);
    expect(box.w).toBe(3 * OPTION_W + 40);
  });
  it("allows more room for a longer answer", () => {
    const short = answerLayout({ x: 0, y: 0 }, ["ok"]).box.h;
    expect(answerLayout({ x: 0, y: 0 }, ["word ".repeat(80)]).box.h).toBeGreaterThan(short);
  });
  it("prefills only when the selection is a question", () => {
    expect(suggestQuestion("Should we charge per seat?")).toBe("Answer this");
    expect(suggestQuestion("Charge per seat")).toBe("");
  });
  it("never leaves an ask silent: every state has words, and a way out when stuck", () => {
    const base = { attempt: 0, askedAt: 0 };
    const opts = { listeners: ["Claude"], now: 4000, given: "“a card”" };
    expect(askStatusLine({ ...base, state: "waiting" }, opts).text).toContain("Waiting for Claude");
    const nobody = askStatusLine({ ...base, state: "waiting" }, { ...opts, listeners: [] });
    expect(nobody.text).toContain("No agent is listening");
    expect(nobody.text).toContain("pnpm --filter @pairedcc/canvas agent");
    expect(nobody.retry).toBe(true);
    // On paired.cc: no local command to offer, and an account nobody serves is told to bring an agent.
    const away = askStatusLine({ ...base, state: "waiting" }, { ...opts, hosted: true, listeners: [] });
    expect(away).toMatchObject({ tone: "nobody", retry: true });
    expect(away.text).not.toContain("pnpm");
    expect(askStatusLine({ ...base, state: "waiting" }, { ...opts, hosted: true, listeners: null }).text).toContain("Connect an agent");
    expect(askStatusLine({ ...base, state: "waiting" }, { ...opts, hosted: true }).text).toContain("Waiting for Claude");
    expect(askStatusLine({ ...base, state: "working", agent: "Claude", note: "reading 1 object", startedAt: 1000 }, opts).text).toBe("Claude: reading 1 object · 3s");
    expect(askStatusLine({ ...base, state: "working", agent: "Claude", startedAt: 0 }, { ...opts, now: 130_000 }).retry).toBe(true);
    expect(askStatusLine({ ...base, state: "failed", error: "Claude took longer than 90 seconds" }, opts)).toMatchObject({ tone: "failed", retry: true });
    expect(askStatusLine({ ...base, state: "answered", agent: "Claude", answeredAt: 3500 }, opts).text).toContain("answered in 4s · given “a card”");
    expect(askStatusLine({ ...base, state: "waiting" }, { ...opts, listeners: null }).text).toContain("Connect an agent");
  });
});

describe("answer contract", () => {
  it("takes one short answer or two to four alternatives, never a wall of text", () => {
    expect(answerInput.safeParse({ id: "shape:a", text: "Short." }).success).toBe(true);
    expect(answerInput.safeParse({ id: "shape:a", alternatives: ["A", "B"] }).success).toBe(true);
    expect(answerInput.safeParse({ id: "shape:a", text: "x".repeat(701) }).success).toBe(false);
    expect(answerInput.safeParse({ id: "shape:a", alternatives: ["only one"] }).success).toBe(false);
    expect(answerInput.safeParse({ id: "shape:a", alternatives: ["1", "2", "3", "4", "5"] }).success).toBe(false);
    expect(answerInput.safeParse({ id: "shape:a", text: "both", alternatives: ["A", "B"] }).success).toBe(false);
    expect(answerInput.safeParse({ id: "shape:a" }).success).toBe(false);
  });
  it("lets an agent report progress and failure but not mark an ask answered without an answer", () => {
    expect(askStatusInput.safeParse({ id: "shape:a", state: "working", note: "reading 2 cards" }).success).toBe(true);
    expect(askStatusInput.safeParse({ id: "shape:a", state: "answered" }).success).toBe(false);
  });
  it("offers the ask tools to MCP agents", () => {
    const names = toolDefs.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["canvas_asks", "canvas_ask_status", "canvas_answer"]));
  });
});

describe("resident agent prompt", () => {
  const given = {
    question: "What's missing?",
    targets: [{ id: "shape:t", type: "card", author: "Human", text: "Charge per seat" }],
    frame: { name: "Pricing", objects: [{ id: "shape:o", type: "card", author: "Claude", text: "Per post today" }] },
    history: [{ who: "Human asked", said: "Why change pricing?" }],
  };
  it("sends only what the ask shows: the question, the selection, its frame and the thread", () => {
    const prompt = buildPrompt(given);
    expect(prompt).toContain('The ask: """What\'s missing?"""');
    expect(prompt).toContain('card written by the person: """Charge per seat"""');
    expect(prompt).toContain('the frame "Pricing"');
    expect(prompt).toContain("Per post today");
    expect(prompt).toContain("Why change pricing?");
    expect(readingNote(given)).toBe('reading 2 objects and the frame "Pricing"');
  });
  it("holds the model to one short step", () => {
    expect(systemPrompt).toContain("At most 60 words");
    expect(systemPrompt).toContain("One step, then stop");
    expect(systemPrompt).toContain("2 to 4 short alternatives");
    expect(systemPrompt).toContain("ask one short question instead of guessing");
  });
  it("reads an answer, alternatives, a question back, fenced JSON and plain prose", () => {
    expect(parseReply('{"read":"your card","kind":"answer","text":"Try it on one team."}')).toEqual({ read: "your card", kind: "answer", text: "Try it on one team." });
    expect(parseReply('```json\n{"kind":"alternatives","alternatives":["Per seat","Per post","Flat"]}\n```').alternatives).toHaveLength(3);
    expect(parseReply('{"kind":"question","text":"Which customers?"}').kind).toBe("question");
    expect(parseReply('{"kind":"alternatives","alternatives":["only one"]}')).toMatchObject({ kind: "answer", text: "only one" });
    expect(parseReply("Just prose.")).toEqual({ kind: "answer", text: "Just prose." });
    expect(() => parseReply("  ")).toThrow();
  });
});

describe("asks carry the person's picks and cross-outs", () => {
  it("reads a mark only when the person set one", () => {
    expect(markOf({ mark: "picked" })).toBe("picked");
    expect(markOf({ mark: "rejected" })).toBe("rejected");
    expect(markOf({ mark: "maybe" })).toBeUndefined();
    expect(markOf({})).toBeUndefined();
  });
  it("keeps each earlier object once and leaves out what is already selected", () => {
    const asked = { who: "Human asked", said: "Options for pricing?" };
    const a = { id: "shape:a", who: "Claude", said: "A · Per seat", mark: "picked" as const };
    const b = { id: "shape:b", who: "Claude", said: "B · Per post", mark: "rejected" as const };
    const c = { id: "shape:c", who: "Claude", said: "C · Flat" };
    // Selecting A and C walks the same thread twice: once from each option.
    const merged = mergeHistory([asked, b, c, asked, a, b], ["shape:a", "shape:c"]);
    expect(merged).toEqual([asked, b]);
  });
  it("tells the model what was picked and crossed out, wherever it sits", () => {
    const prompt = buildPrompt({
      question: "Take this further",
      targets: [{ id: "shape:a", type: "card", author: "Claude", text: "A · Per seat", mark: "picked" }],
      frame: { name: "Pricing", objects: [{ id: "shape:n", type: "card", author: "Human", text: "Usage based", mark: "rejected" }] },
      history: [
        { who: "Human asked", said: "Options for pricing?" },
        { id: "shape:b", who: "Claude", said: "B · Per post", mark: "rejected" },
        { id: "shape:c", who: "Claude", said: "C · Flat" },
      ],
    });
    expect(prompt).toContain('card written by Claude (an agent), which the person picked: """A · Per seat"""');
    expect(prompt).toContain('card by the person, which the person crossed out: """Usage based"""');
    expect(prompt).toContain("- Claude: B · Per post (the person crossed this out)");
    expect(prompt).toContain("- Claude: C · Flat\n");
    expect(systemPrompt).toContain("Build on what the person picked");
    expect(systemPrompt).toContain("Do not offer again what they crossed out");
  });
});
