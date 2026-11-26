// The ask desk: tabs announce asks, agents wait for them. One ask goes to one agent,
// and tabs are told which agents are listening so an ask never waits in silence.

export type AnnouncedAsk = { id: string; attempt: number } & Record<string, unknown>;
export type Delivery = { sessionId: string; ask: AnnouncedAsk };
type Waiter = { agent: string; resolve: (delivery: Delivery | null) => void; timer: ReturnType<typeof setTimeout> };

/** How long an agent still counts as listening between two waits. */
export const LISTENER_GRACE_MS = 6000;

export class AskDesk {
  private queue: (Delivery & { key: string })[] = [];
  private known = new Set<string>();
  private waiters: Waiter[] = [];
  private lastSeen = new Map<string, number>();
  private announced = "";

  constructor(
    private onListeners: (agents: string[]) => void = () => undefined,
    private now: () => number = Date.now,
  ) {}

  /** Queue an ask, or hand it straight to a waiting agent. A repeated attempt is ignored. */
  announce(sessionId: string, ask: AnnouncedAsk) {
    const key = `${sessionId}:${ask.id}:${ask.attempt}`;
    if (this.known.has(key)) return false;
    this.known.add(key);
    if (this.known.size > 2000) this.known.delete(this.known.values().next().value!);
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      this.touch(waiter.agent);
      waiter.resolve({ sessionId, ask });
    } else this.queue.push({ key, sessionId, ask });
    return true;
  }

  /** Wait for the next ask. Resolves with null when nothing arrives in time. */
  wait(agent: string, waitMs: number) {
    let cancel = () => undefined as void;
    const promise = new Promise<Delivery | null>((resolve) => {
      this.touch(agent);
      const next = this.queue.shift();
      if (next) return resolve({ sessionId: next.sessionId, ask: next.ask });
      const done = (delivery: Delivery | null) => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        this.touch(agent);
        resolve(delivery);
        this.settle();
      };
      const waiter: Waiter = { agent, resolve: done, timer: setTimeout(() => done(null), waitMs) };
      cancel = () => {
        clearTimeout(waiter.timer);
        done(null);
      };
      this.waiters.push(waiter);
      this.publish();
    });
    return { promise, cancel };
  }

  /** Agents waiting now, or seen a moment ago (they are between two waits or answering). */
  listeners() {
    const cutoff = this.now() - LISTENER_GRACE_MS;
    const names = new Set(this.waiters.map((w) => w.agent));
    for (const [agent, at] of this.lastSeen) {
      if (at >= cutoff) names.add(agent);
      else this.lastSeen.delete(agent);
    }
    return [...names].sort();
  }

  /** Forget asks from a tab that has gone away. */
  dropSession(sessionId: string) {
    this.queue = this.queue.filter((entry) => {
      if (entry.sessionId !== sessionId) return true;
      this.known.delete(entry.key);
      return false;
    });
  }

  private touch(agent: string) {
    this.lastSeen.set(agent, this.now());
  }

  /** After a wait ends, check once the grace period is over whether the agent came back. */
  private settle() {
    this.publish();
    const timer = setTimeout(() => this.publish(), LISTENER_GRACE_MS + 250);
    timer.unref?.();
  }

  private publish() {
    const agents = this.listeners(), signature = agents.join("\n");
    if (signature === this.announced) return;
    this.announced = signature;
    this.onListeners(agents);
  }
}
