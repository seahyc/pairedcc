import { describe, it, expect, vi } from "vitest";
import { AskDesk, LISTENER_GRACE_MS } from "../server/asks";
import { answerLayout, askStatusLine, retryLabel, capWords, elsewhereNotice, markOf, mergeHistory, suggestQuestion, OPTION_W } from "../src/ask-rules";
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
  it("a newer attempt replaces an older one nobody has taken yet", async () => {
    const desk = new AskDesk();
    desk.announce("tab", ask("shape:a", 0));
    desk.announce("tab", ask("shape:a", 1));
    desk.announce("tab", ask("shape:b", 0));
    expect((await desk.wait("Claude", 10).promise)?.ask).toEqual(ask("shape:a", 1));
    expect((await desk.wait("Claude", 10).promise)?.ask.id).toBe("shape:b");
    expect(await desk.wait("Claude", 10).promise).toBeNull();
  });
  it("an attempt already taken is not replaced, and an older attempt waits behind a newer one", async () => {
    const desk = new AskDesk();
    desk.announce("tab", ask("shape:a", 1));
    expect((await desk.wait("Claude", 10).promise)?.ask.attempt).toBe(1);
    desk.announce("tab", ask("shape:a", 2));
    expect(desk.announce("tab", ask("shape:a", 0))).toBe(false);
    expect((await desk.wait("Claude", 10).promise)?.ask.attempt).toBe(2);
    expect(await desk.wait("Claude", 10).promise).toBeNull();
  });
  it("a board restored to an earlier attempt can send it again after a reload", async () => {
    const desk = new AskDesk();
    desk.announce("tab", ask("shape:a", 0));
    desk.announce("tab", ask("shape:a", 1));
    desk.dropSession("tab");
    expect(desk.announce("tab", ask("shape:a", 0))).toBe(true);
    expect((await desk.wait("Claude", 10).promise)?.ask.attempt).toBe(0);
  });
  it("asks of other tabs or with lookalike ids never replace each other", async () => {
    const desk = new AskDesk();
    desk.announce("a:b", ask("c", 0));
    desk.announce("a", ask("b:c", 1));
    const got = [await desk.wait("Claude", 10).promise, await desk.wait("Claude", 10).promise].map((d) => `${d?.sessionId}|${d?.ask.id}`);
    expect(got.sort()).toEqual(["a:b|c", "a|b:c"]);
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
    expect(askStatusLine({ ...base, state: "answered", agent: "Claude", answeredAt: 3500 }, opts).text).toContain("answered in 4s · also read “a card”");
    expect(askStatusLine({ ...base, state: "waiting" }, { ...opts, listeners: null }).text).toContain("Connect an agent");
  });
  it("names a connected agent that acted on the board recently instead of saying there is none", () => {
    const base = { attempt: 0, askedAt: 0, state: "waiting" };
    const recent = { actor: "Claude Code", at: 0 };
    // paired.cc, an account the resident agent does not serve
    const hosted = askStatusLine(base, { listeners: null, hosted: true, now: 40_000, given: "", recent });
    expect(hosted).toMatchObject({ tone: "waiting" });
    expect(hosted.text).toBe("Claude Code was here 40s ago. In your chat, ask it to answer this.");
    expect(hosted.text).not.toContain("Connect an agent");
    // locally, with no resident agent running
    const local = askStatusLine(base, { listeners: [], now: 3 * 60_000, given: "", recent });
    expect(local).toMatchObject({ tone: "nobody", retry: true });
    expect(local.text).toBe("Claude Code was here 3 min ago. In your chat, ask it to answer this.");
    // an agent seen long ago does not count
    const stale = askStatusLine(base, { listeners: null, hosted: true, now: 11 * 60_000, given: "", recent });
    expect(stale.text).toContain("Connect an agent");
    // a listening agent still wins
    expect(askStatusLine(base, { listeners: ["Resident"], now: 4000, given: "", recent }).text).toContain("Waiting for Resident");
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
    expect(prompt).toContain('The person wrote this, and it is what you respond to: """What\'s missing?"""');
    const alone = buildPrompt({ question: "What's the GDP of Singapore?", targets: [] });
    expect(alone).toContain('"""What\'s the GDP of Singapore?"""');
    expect(alone).not.toContain("sits beside");
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
  it("keeps two asks with the same words, and one ask reached twice once", () => {
    const first = { id: "shape:ask1", who: "Human asked", said: "Give me alternatives" };
    const again = { id: "shape:ask2", who: "Human asked", said: "Give me alternatives" };
    expect(mergeHistory([first, again, first], [])).toEqual([first, again]);
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

describe("an ask about a frame is about what it holds", () => {
  const ask = {
    question: "What do these have in common?",
    targets: [
      {
        id: "shape:f", type: "frame", author: "Human", text: "(Pricing, no text)",
        inside: [
          { id: "shape:1", type: "card", author: "Human", text: "Per seat" },
          { id: "shape:2", type: "card", author: "Claude", text: "Per post", mark: "rejected" as const },
        ],
        insideMore: 3,
      },
    ],
  };
  it("lists the frame's objects under it, with marks and what was left out", () => {
    const prompt = buildPrompt(ask);
    expect(prompt).toContain('- the frame "Pricing", which holds:');
    expect(prompt).toContain('  - card by the person: """Per seat"""');
    expect(prompt).toContain('  - card by Claude (an agent), which the person crossed out: """Per post"""');
    expect(prompt).toContain("  - and 3 more not shown");
    expect(prompt).not.toContain("no text");
    expect(readingNote(ask)).toBe("reading 3 objects");
  });
  it("says so when the frame holds nothing with text", () => {
    const empty = { question: "?", targets: [{ id: "shape:f", type: "frame", author: "Human", text: "(Ideas, no text)", inside: [] }] };
    expect(buildPrompt(empty)).toContain('- the frame "Ideas", which holds nothing with text.');
  });
});

describe("an ask answered on a page the person has left", () => {
  const where = { onScreen: false, question: "Give me options", pageName: "Pricing" };
  it("says who answered and where", () => {
    expect(elsewhereNotice({ state: "working" }, { state: "answered", agent: "Claude" }, where)).toBe("✦ Claude answered “Give me options” on the page “Pricing”.");
    expect(elsewhereNotice({ state: "working" }, { state: "failed" }, where)).toContain("could not be answered. Show it to retry.");
  });
  it("stays quiet on screen, for other states and for repeats", () => {
    expect(elsewhereNotice({ state: "working" }, { state: "answered" }, { ...where, onScreen: true })).toBeUndefined();
    expect(elsewhereNotice({ state: "waiting" }, { state: "working" }, where)).toBeUndefined();
    expect(elsewhereNotice({ state: "answered" }, { state: "answered" }, where)).toBeUndefined();
    expect(elsewhereNotice(undefined, undefined, where)).toBeUndefined();
  });
  it("shortens a long question", () => {
    const said = elsewhereNotice({ state: "working" }, { state: "answered" }, { ...where, question: "x".repeat(80) })!;
    expect(said).toContain(`“${"x".repeat(39)}…”`);
  });
});

import { elsewhereShow, noticeMs } from "../src/ask-rules";
describe("showing an ask answered on another page", () => {
  const replies = [
    { id: "shape:a", replyTo: "shape:ask" },
    { id: "shape:b", replyTo: "shape:ask" },
    { id: "shape:other", replyTo: "shape:elsewhere" },
    { id: "shape:gone", replyTo: "shape:ask", hidden: true },
    { id: "shape:plain" },
  ];
  it("selects the answers to that ask, in board order, leaving out hidden ones", () => {
    expect(elsewhereShow("answered", "shape:ask", replies)).toEqual(["shape:a", "shape:b"]);
  });
  it("selects the ask itself when it failed, so Retry is on the selection", () => {
    expect(elsewhereShow("failed", "shape:ask", replies)).toEqual(["shape:ask"]);
  });
  it("falls back to the ask when its answers have been deleted or hidden", () => {
    expect(elsewhereShow("answered", "shape:ask", [{ id: "shape:gone", replyTo: "shape:ask", hidden: true }])).toEqual(["shape:ask"]);
  });
  it("offers nothing for other states", () => {
    expect(elsewhereShow("working", "shape:ask", replies)).toEqual([]);
    expect(elsewhereShow("waiting", "shape:ask", replies)).toEqual([]);
  });
  it("keeps a notice with something to press long enough to press it", () => {
    expect(noticeMs(false)).toBe(3500);
    expect(noticeMs(true)).toBeGreaterThanOrEqual(10000);
  });
});

import { startersFor, starters as defaultStarters } from "../src/ask-rules";
describe("starters that fit the selection", () => {
  const card = (text: string) => ({ type: "card", text });
  it("keeps the usual three for one thought", () => {
    expect(startersFor([card("Charge per seat")])).toEqual(defaultStarters);
    expect(startersFor([])).toEqual(defaultStarters);
  });
  it("offers to answer a question", () => {
    expect(startersFor([card("Should we charge per seat?")])[0]).toBe("Answer this");
  });
  it("offers comparison, on named dimensions, for several objects", () => {
    expect(startersFor([card("Option A"), card("Option B")])).toEqual([
      "Compare these",
      "What dimensions do these differ on?",
      "What do they have in common?",
    ]);
  });
  it("offers questions about the group for a frame, whose contents the ask now sends", () => {
    expect(startersFor([{ type: "frame", text: "" }])[0]).toBe("What do these have in common?");
  });
  it("offers questions about what a chart shows, and about a dataset, now that the ask sends them", () => {
    expect(startersFor([{ type: "chart", text: "" }])[0]).toBe("What does this show?");
    expect(startersFor([{ type: "dataset", text: "" }])[0]).toBe("What is in this data?");
  });
  it("never offers more than three", () => {
    for (const sel of [[card("a")], [card("a?")], [card("a"), card("b")], [{ type: "frame", text: "" }], [{ type: "chart", text: "" }]])
      expect(startersFor(sel).length).toBeLessThanOrEqual(3);
  });
});

describe("retryLabel: the selection bar's first button on one selected ask", () => {
  const ask = (state: string, extra: Record<string, unknown> = {}) => ({ state, attempt: 0, contextIds: [], askedAt: 0, ...extra }) as never;
  const line = (a: never, listeners: string[] | null = ["Claude"], now = 1000) => askStatusLine(a, { listeners, hosted: false, now, given: "" });
  it("retries a failed ask", () => {
    expect(retryLabel(line(ask("failed", { error: "Took too long" })))).toBe("Retry");
  });
  it("retries an ask whose agent went quiet", () => {
    expect(retryLabel(line(ask("working", { startedAt: 0, agent: "Claude" }), ["Claude"], 200_000))).toBe("Retry");
  });
  it("sends again an ask nobody heard", () => {
    const said = retryLabel(line(ask("waiting"), [], 60_000));
    expect(said).toBe("Send again");
  });
  it("keeps Ask for an answered, working or waiting ask", () => {
    expect(retryLabel(line(ask("answered", { answeredAt: 10, agent: "Claude" })))).toBeUndefined();
    expect(retryLabel(line(ask("working", { startedAt: 900, agent: "Claude" })))).toBeUndefined();
    expect(retryLabel(line(ask("waiting")))).toBeUndefined();
  });
});
