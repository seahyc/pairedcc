import { check, mcpAgent, openCanvas, sleep, until, type Browser, type Check } from "../lib";

// The calm canvas's core loop: the person writes a thought, selects it and asks; an agent
// answers; the ask shows where it stands the whole time. The person acts through the real
// page (keys and clicks), the agent through a real stdio MCP client. Nothing here starts a
// resident agent or calls a model: the agent's words are fixed, made up for the check.

type Status = { state: string | null; tone: string | null; text: string; overflow: boolean; retry: boolean };

/** No text line may be wider than its card, and no card wider than a reading width (as verify-calm). */
const spills = (page: any) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".tl-shape")].flatMap((el) => {
      const t = el.querySelector(".tl-rich-text");
      if (!t) return [];
      const box = el.getBoundingClientRect(), text = t.getBoundingClientRect();
      const bad = t.scrollWidth > t.clientWidth + 1 || text.right > box.right + 2 || text.bottom > box.bottom + 2 || box.width > 640;
      return bad ? [`${el.getAttribute("data-shape-type")}: text needs ${t.scrollWidth}px in ${t.clientWidth}px (card ${Math.round(box.width)}px)`] : [];
    }),
  ) as Promise<string[]>;

export async function askLoop(browser: Browser, base: string) {
  const steps: Check[] = [];
  const { context, page, session } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session);
  const status = (askId: string) =>
    page.evaluate((id: string) => {
      const rows = [...document.querySelectorAll(".ask-status")] as HTMLElement[];
      // The status line sits under its ask; match it by position to the ask's own shape.
      const ask = document.querySelector(`[data-shape-id="${id}"]`) as HTMLElement | null;
      const near = ask
        ? rows.sort((a, b) => Math.abs(a.getBoundingClientRect().top - ask.getBoundingClientRect().bottom) - Math.abs(b.getBoundingClientRect().top - ask.getBoundingClientRect().bottom))[0]
        : rows.at(-1);
      if (!near) return null;
      return {
        state: near.getAttribute("data-ask-state"),
        tone: near.getAttribute("data-ask-tone"),
        text: near.textContent ?? "",
        overflow: near.scrollWidth > near.clientWidth + 1,
        retry: !!near.querySelector("button"),
      };
    }, askId) as Promise<Status | null>;
  const waitFor = async (id: string, state?: string) =>
    (await until(async () => {
      const now = await status(id);
      return now && (!state || now.state === state) ? now : undefined;
    }, `the ask to show ${state ?? "a status line"}`)) as Status;
  const asksNow = async () => ((await agent.call("canvas_asks", { state: "all" })).asks ?? []) as any[];
  /** The person writes a card at a point (N, click, type) and finishes it with `finish`. */
  const write = async (text: string, at: { x: number; y: number }, finish: "Escape" | "ControlOrMeta+Enter") => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("n");
    await page.mouse.click(at.x, at.y);
    await sleep(300);
    await page.keyboard.type(text, { delay: 2 });
    await page.keyboard.press(finish);
    await sleep(400);
  };
  /** The card is the question (7cc29ef): what the person writes is the ask, with no box. */
  const ask = async (text: string, at: { x: number; y: number }, finish: "Escape" | "ControlOrMeta+Enter") => {
    const before = new Set((await asksNow()).map((a) => a.id));
    await write(text, at, finish);
    return until(async () => (await asksNow()).find((a) => !before.has(a.id)), "the ask to reach the board");
  };
  let first: any;
  try {
    await agent.call("canvas_page", { name: "Ask loop" });

    await check(steps, "Person writes a question beside a thought; finishing it asks, and the ask says who can answer", async () => {
      // A thought with no question mark is not sent by finishing it; a question beside it is.
      const before = (await asksNow()).length;
      await write("Teams hire in bursts, then not for months", { x: 520, y: 360 }, "Escape");
      if ((await asksNow()).length !== before) return "a card without a question mark was sent when the person finished it";
      first = await ask("Should we charge per seat instead of per job post?", { x: 520, y: 470 }, "Escape");
      const s = await waitFor(first.id);
      if (s.state !== "waiting") return `ask state is ${s.state}`;
      if (s.overflow) return `status text overflows: ${s.text}`;
      // Nobody is listening in the eval: the line must say how to get an answer, never be silent.
      return /pnpm|chat|Connect an agent|Waiting for/.test(s.text) ? true : `status gives no way to an answer: ${JSON.stringify(s.text)}`;
    });

    await check(steps, "An external agent finds the ask and what it is about over MCP", async () => {
      if (!first) return "no ask was made";
      const listed = (await agent.call("canvas_asks", {})).asks ?? [];
      const mine = listed.find((a: any) => a.id === first.id);
      if (!mine) return `canvas_asks (waiting) does not list the ask; it lists ${listed.length}`;
      if (mine.question !== "Should we charge per seat instead of per job post?") return `question is ${JSON.stringify(mine.question)}`;
      // What sits right beside the question goes with it.
      return (mine.targets ?? []).some((t: any) => (t.text ?? "").includes("hire in bursts")) ? true : `the thought beside the question is not given: ${JSON.stringify(mine.targets)}`;
    });

    await check(steps, "The page shows the agent working, with what it is doing", async () => {
      if (!first) return "no ask was made";
      await agent.call("canvas_ask_status", { id: first.id, state: "working", note: "reading 1 card" });
      const s = await waitFor(first.id, "working");
      return /reading 1 card/.test(s.text) && /MCP agent/.test(s.text) ? true : `working line is ${JSON.stringify(s.text)}`;
    });

    await check(steps, "The answer appears beside the ask, inside its cards, and the ask says answered", async () => {
      if (!first) return "no ask was made";
      await agent.call("canvas_answer", {
        id: first.id,
        read: "your card",
        alternatives: ["Per seat punishes growing teams.", "Per post matches how often they hire.", "Ask three customers which they would pay."],
      });
      const s = await waitFor(first.id, "answered");
      if (!/MCP agent answered/.test(s.text)) return `answered line is ${JSON.stringify(s.text)}`;
      const objects = (await agent.call("canvas_read")).objects ?? [];
      const askObj = objects.find((o: any) => o.id === first.id);
      const answers = objects.filter((o: any) => o.meta?.replyTo === first.id);
      if (answers.length !== 3) return `${answers.length} answer cards, expected 3`;
      const a = askObj.bounds;
      const far = answers.filter((o: any) => {
        const b = o.bounds;
        const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
        return gap > 400;
      });
      if (far.length) return `${far.length} answers are more than 400 px from the ask`;
      await agent.call("canvas_focus", { ids: [first.id, ...answers.map((o: any) => o.id)] });
      await sleep(600);
      const bad = await spills(page);
      return bad.length ? `text spills out of: ${bad.join("; ")}` : true;
    });

    await check(steps, "Any card is sent with ⌘↵; a failed ask says why and offers Retry, which asks again", async () => {
      const second = await ask("Hire a second designer before launch", { x: 1000, y: 260 }, "ControlOrMeta+Enter");
      if (second.question !== "Hire a second designer before launch") return `⌘↵ sent ${JSON.stringify(second.question)}`;
      await agent.call("canvas_ask_status", { id: second.id, state: "failed", error: "I could not reach the pricing notes" });
      const s = await waitFor(second.id, "failed");
      if (!/could not reach the pricing notes/.test(s.text)) return `failed line is ${JSON.stringify(s.text)}`;
      if (!s.retry) return "no Retry button on a failed ask";
      await page.locator(".ask-status", { hasText: "could not reach the pricing notes" }).getByRole("button").click();
      const again = await until(async () => ((await agent.call("canvas_asks", {})).asks ?? []).find((a: any) => a.id === second.id), "the retried ask to wait again");
      return again.attempt > second.attempt ? true : `attempt ${again.attempt} did not rise from ${second.attempt}`;
    });
  } finally {
    await agent.close();
    await context.close();
  }
  return { steps };
}
