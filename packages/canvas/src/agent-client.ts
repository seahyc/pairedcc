import { z } from "zod";
import { atom, type Editor } from "tldraw";
import { createRunLedger, runCommand } from "./agent-runs";
import { envelopeSchema } from "./protocol";
import { listAsks } from "./asks";

const requestSchema = envelopeSchema.extend({ id: z.string() });
type Reply = (message: { id: string; ok: boolean; result?: unknown; error?: string }) => void;

export type AgentLink =
  | { mode: "local"; state?: "connected" | "disconnected" }
  | { mode: "hosted"; state: "signed-out" | "connecting" | "connected"; email?: string };

/** Current agent connection, for the Agent access panel. */
export const agentLink = atom<AgentLink>("agent link", { mode: "hosted", state: "signed-out" });

/** The last thing an agent did on this canvas, for the status chip in the top bar. */
export const agentActivity = atom<{ actor: string; op: string; at: number; ok: boolean; error?: string; via?: "mcp" } | null>("agent activity", null);

/**
 * Agents waiting for asks right now. null where presence cannot be known (on paired.cc,
 * an account the resident agent does not serve), an empty list when nobody is listening.
 */
export const agentListeners = atom<string[] | null>("agent listeners", null);

// Agents that have waited for asks in this tab. One that stops listening is a background
// agent that went away, not a chat agent the person can ask, so it is never offered as one.
const listenedBefore = new Set<string>();
export function setListeners(value: string[] | null) {
  for (const name of value ?? []) listenedBefore.add(name);
  agentListeners.set(value);
}

/**
 * The last agent that acted here, if it is one the person can ask in their own chat: an MCP
 * client, never a script (such as the feedback export) or an agent that listened for asks.
 */
export function chatAgentActivity<T extends { actor: string; at: number; via?: "mcp" }>(activity: T | null) {
  return activity && activity.via === "mcp" && !listenedBefore.has(activity.actor) ? activity : null;
}

let sendAsk: ((ask: { id: string; attempt: number }) => void) | undefined;
/** Tell listening agents about an ask. Safe to repeat: the relay ignores an attempt it has seen. */
export function announceAsk(ask: { id: string; attempt: number }) {
  sendAsk?.(ask);
}

function sessionId() {
  const id = sessionStorage.getItem("picabird-agent-session") ?? crypto.randomUUID();
  sessionStorage.setItem("picabird-agent-session", id);
  document.documentElement.dataset.pairedSession = id;
  return id;
}

/** Runs agent commands against the editor, once per requestId. */
function commandRunner(editor: Editor, session: string, isClosed: () => boolean) {
  const seen = new Map<string, Promise<unknown>>();
  const runs = createRunLedger();
  return (raw: unknown, reply: Reply) => {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.sessionId !== session || isClosed()) return;
    const { id, command, actor, requestId, via } = parsed.data;
    let work = seen.get(requestId);
    if (!work) {
      work = runCommand(editor, runs, command, actor, requestId);
      seen.set(requestId, work);
      if (seen.size > 500) seen.delete(seen.keys().next().value!);
    }
    void work
      .then((result) => {
        agentActivity.set({ actor, op: command.op, at: Date.now(), ok: true, via });
        if (!isClosed()) reply({ id, ok: true, result });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Canvas operation failed";
        agentActivity.set({ actor, op: command.op, at: Date.now(), ok: false, error: message, via });
        if (!isClosed()) reply({ id, ok: false, error: message });
      });
  };
}

/**
 * Lets agents work on this canvas. In development the Vite relay carries commands
 * from the local MCP server; on paired.cc a signed-in tab connects to the hosted
 * relay behind https://paired.cc/mcp.
 */
export function connectAgentAccess(editor: Editor, onChange: (link: AgentLink) => void = (link) => agentLink.set(link)) {
  const hot = import.meta.hot;
  const session = sessionId();
  let closed = false;
  const run = commandRunner(editor, session, () => closed);

  if (hot) {
    onChange({ mode: "local" });
    const hello = () => hot.send("paired:hello", { sessionId: session, title: document.title });
    const request = (raw: unknown) => run(raw, (message) => hot.send("paired:response", message));
    const listeners = (raw: unknown) => {
      const agents = (raw as { agents?: unknown }).agents;
      if (Array.isArray(agents)) setListeners(agents.filter((a): a is string => typeof a === "string"));
    };
    sendAsk = (ask) => hot.send("paired:ask", { sessionId: session, ask });
    // Asks still waiting are announced again whenever the link comes up, so none is lost to a restart.
    const up = () => {
      onChange({ mode: "local", state: "connected" });
      for (const ask of listAsks(editor, { state: "waiting" }).asks) announceAsk(ask);
    };
    const down = () => onChange({ mode: "local", state: "disconnected" });
    hot.on("paired:request", request);
    hot.on("paired:connected", up);
    hot.on("paired:listeners", listeners);
    hot.on("vite:ws:connect", hello);
    hot.on("vite:ws:disconnect", down);
    hello();
    return () => {
      hot.send("paired:bye", { sessionId: session });
      closed = true;
      hot.off("paired:request", request);
      hot.off("paired:connected", up);
      hot.off("paired:listeners", listeners);
      sendAsk = undefined;
      hot.off("vite:ws:connect", hello);
      hot.off("vite:ws:disconnect", down);
    };
  }

  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let email: string | undefined;

  const connect = async () => {
    if (closed || socket) return;
    clearTimeout(retry);
    try {
      const me = await fetch("/auth/me", { credentials: "same-origin" });
      if (!me.ok) {
        onChange({ mode: "hosted", state: "signed-out" });
        return;
      }
      email = ((await me.json()) as { email?: string }).email;
    } catch {
      retry = setTimeout(connect, 10_000);
      return;
    }
    if (closed || socket) return;
    onChange({ mode: "hosted", state: "connecting", email });
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/canvas-relay`);
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", sessionId: session, title: document.title }));
    ws.onmessage = (event) => {
      let message: { type?: string } & Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === "connected") {
        attempts = 0;
        onChange({ mode: "hosted", state: "connected", email });
        // Asks still waiting are announced again whenever the link comes up, so none is lost to a restart.
        sendAsk = (ask) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ask", ask }));
        for (const ask of listAsks(editor, { state: "waiting" }).asks) announceAsk(ask);
      } else if (message.type === "listeners") {
        // Only sent to accounts the resident agent serves; everyone else brings their own agent.
        if (Array.isArray(message.agents)) setListeners(message.agents.filter((a): a is string => typeof a === "string"));
      } else if (message.type === "request") {
        // The hosted relay carries only MCP clients' commands (and the resident agent's, which listens).
        run({ ...message, via: "mcp" }, (reply) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "response", ...reply })));
      }
    };
    ws.onclose = () => {
      if (socket === ws) {
        socket = undefined;
        sendAsk = undefined;
        setListeners(null);
      }
      if (closed) return;
      onChange({ mode: "hosted", state: "connecting", email });
      attempts += 1;
      retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)));
    };
  };

  // Signing in usually happens in another tab (the agent's sign-in page), so check again on return.
  const recheck = () => {
    if (document.visibilityState === "visible" && !socket) void connect();
  };
  document.addEventListener("visibilitychange", recheck);
  window.addEventListener("focus", recheck);
  void connect();

  return () => {
    closed = true;
    clearTimeout(retry);
    document.removeEventListener("visibilitychange", recheck);
    window.removeEventListener("focus", recheck);
    socket?.close(1000, "Canvas closed");
  };
}
