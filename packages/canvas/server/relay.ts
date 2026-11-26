import { randomUUID } from "node:crypto";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import type { Plugin, WebSocketClient } from "vite";
import {
  envelopeSchema,
  clientHelloSchema,
  responseSchema,
  askAnnounceSchema,
  askWaitSchema,
  type CommandResponse,
} from "../src/protocol";

import { AskDesk } from "./asks";

const API = "/api/canvas";
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function isLocalRequest(req: {
  headers: Pick<IncomingHttpHeaders, "host" | "origin">;
  socket: Pick<Socket, "remoteAddress">;
}) {
  const address = req.socket.remoteAddress;
  if (!address || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address))
    return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!localHosts.has(host.hostname)) return false;
    const origin = req.headers.origin;
    return !origin || new URL(origin).origin === host.origin;
  } catch {
    return false;
  }
}
function reply(res: ServerResponse, status: number, body: unknown) {
  if (res.destroyed) return;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > 8_000_000)
      throw new Error("Request too large");
  }
  return JSON.parse(body);
}
export function canvasRelay(): Plugin {
  return {
    name: "paired-local-agent-api",
    configureServer(server) {
      const sessions = new Map<
        string,
        { client: WebSocketClient; title: string }
      >();
      const pending = new Map<
        string,
        {
          client: WebSocketClient;
          resolve: (response: CommandResponse) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >();
      const recent = new Map<
        string,
        { body: string; result: Promise<CommandResponse> }
      >();
      const desk = new AskDesk((agents) => {
        for (const session of sessions.values()) session.client.send("paired:listeners", { agents });
      });
      server.ws.on("paired:ask", (raw, client) => {
        const parsed = askAnnounceSchema.safeParse(raw);
        if (!parsed.success || sessions.get(parsed.data.sessionId)?.client.socket !== client.socket) return;
        desk.announce(parsed.data.sessionId, parsed.data.ask);
      });
      server.ws.on("paired:hello", (raw, client) => {
        const parsed = clientHelloSchema.safeParse(raw);
        if (!parsed.success) return;
        const { sessionId, title } = parsed.data;
        for (const [id, session] of sessions)
          if (id !== sessionId && session.client.socket === client.socket)
            sessions.delete(id);
        sessions.set(sessionId, { client, title });
        client.send("paired:connected", { sessionId });
        client.send("paired:listeners", { agents: desk.listeners() });
      });
      server.ws.on("paired:bye", (raw, client) => {
        const parsed = clientHelloSchema
          .pick({ sessionId: true })
          .safeParse(raw);
        if (
          parsed.success &&
          sessions.get(parsed.data.sessionId)?.client.socket === client.socket
        )
          sessions.delete(parsed.data.sessionId);
      });
      server.ws.on("paired:response", (raw, client) => {
        const parsed = responseSchema.safeParse(raw);
        if (!parsed.success) return;
        const request = pending.get(parsed.data.id);
        if (!request || request.client !== client) return;
        clearTimeout(request.timer);
        pending.delete(parsed.data.id);
        request.resolve(parsed.data);
      });
      server.ws.on("connection", (socket, request) => {
        if (!isLocalRequest(request)) {
          socket.close(1008, "Local canvas connections only");
          return;
        }
        socket.on("close", () => {
          for (const [id, s] of sessions)
            if (s.client.socket === socket) {
              sessions.delete(id);
              desk.dropSession(id);
            }
          for (const [id, p] of pending)
            if (p.client.socket === socket) {
              clearTimeout(p.timer);
              pending.delete(id);
              p.resolve({
                id,
                ok: false,
                error:
                  "Canvas disconnected before acknowledging. Outcome is unknown; read before retrying.",
              });
            }
        });
      });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith(API)) return next();
        if (!isLocalRequest(req))
          return reply(res, 403, {
            error: "Canvas API accepts same-origin loopback requests only",
          });
        if (req.method === "GET" && url.pathname === `${API}/sessions`) {
          return reply(res, 200, {
            sessions: [...sessions].map(([id, s]) => ({ id, title: s.title })),
            listeners: desk.listeners(),
            apiVersion: 1,
          });
        }
        // Long poll: an agent waits here for the next ask a human makes on any open canvas.
        if (req.method === "POST" && url.pathname === `${API}/asks/wait`) {
          void (async () => {
            try {
              const parsed = askWaitSchema.safeParse(await readBody(req));
              if (!parsed.success) return reply(res, 400, { error: parsed.error.message });
              const waiting = desk.wait(parsed.data.agent, parsed.data.waitMs);
              res.on("close", () => {
                if (!res.writableEnded) waiting.cancel();
              });
              const delivery = await waiting.promise;
              reply(res, 200, delivery ?? { ask: null });
            } catch (error) {
              reply(res, 400, { error: error instanceof Error ? error.message : "Invalid request" });
            }
          })();
          return;
        }
        if (req.method !== "POST" || url.pathname !== `${API}/command`)
          return reply(res, 404, {
            error: "Use GET /api/canvas/sessions, POST /api/canvas/command or POST /api/canvas/asks/wait",
          });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return reply(res, 415, {
            error: "Content-Type must be application/json",
          });
        void (async () => {
          try {
            const parsed = envelopeSchema.safeParse(await readBody(req));
            if (!parsed.success)
              return reply(res, 400, { error: parsed.error.message });
            const envelope = parsed.data;
            const sessionId =
              envelope.sessionId ??
              (sessions.size === 1 ? [...sessions.keys()][0] : undefined);
            if (!sessionId)
              return reply(res, 409, {
                error: sessions.size
                  ? "Several canvases are open. Specify sessionId."
                  : "Open Paired in a browser first.",
              });
            const session = sessions.get(sessionId);
            if (!session)
              return reply(res, 404, { error: "Canvas session not connected" });
            const key = `${sessionId}:${envelope.requestId}`,
              body = JSON.stringify({ ...envelope, sessionId });
            let request = recent.get(key);
            if (request && request.body !== body)
              return reply(res, 409, {
                error: "requestId was already used with different content",
              });
            if (!request) {
              // Keep the newest 1,000 requests; an agent that waits all day must not fill the ledger.
              if (recent.size >= 1000) recent.delete(recent.keys().next().value!);
              const id = randomUUID();
              const result = new Promise<CommandResponse>((resolve) => {
                const timer = setTimeout(() => {
                  pending.delete(id);
                  resolve({
                    id,
                    ok: false,
                    error:
                      "Canvas did not acknowledge within 15 seconds. Outcome is unknown; read before issuing a new request.",
                  });
                }, 15000);
                pending.set(id, { client: session.client, resolve, timer });
                session.client.send("paired:request", {
                  ...envelope,
                  id,
                  sessionId,
                });
              });
              request = { body, result };
              recent.set(key, request);
            }
            const response = await request.result;
            reply(res, response.ok ? 200 : 422, response);
          } catch (error) {
            reply(res, 400, {
              error: error instanceof Error ? error.message : "Invalid request",
            });
          }
        })();
      });
      server.httpServer?.on("close", () => {
        for (const p of pending.values()) clearTimeout(p.timer);
        pending.clear();
        sessions.clear();
        recent.clear();
      });
    },
  };
}
