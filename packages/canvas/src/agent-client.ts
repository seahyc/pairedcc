import { z } from "zod";
import type { Editor } from "tldraw";
import { executeCommand } from "./agent-operations";
import { envelopeSchema } from "./protocol";

const requestSchema = envelopeSchema.extend({ id: z.string() });
export function connectAgentAccess(editor: Editor) {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  const sessionId =
    sessionStorage.getItem("picabird-agent-session") ?? crypto.randomUUID();
  sessionStorage.setItem("picabird-agent-session", sessionId);
  document.documentElement.dataset.pairedSession = sessionId;
  let closed = false;
  const seen = new Map<string, Promise<unknown>>();
  const hello = () =>
    hot.send("paired:hello", { sessionId, title: document.title });
  const request = (raw: unknown) => {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.sessionId !== sessionId || closed)
      return;
    const { id, command, actor, requestId } = parsed.data;
    let work = seen.get(requestId);
    if (!work) {
      work = executeCommand(editor, command, actor);
      seen.set(requestId, work);
    }
    void work
      .then((result) => {
        if (!closed) hot.send("paired:response", { id, ok: true, result });
      })
      .catch((error) => {
        if (!closed)
          hot.send("paired:response", {
            id,
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Canvas operation failed",
          });
      });
  };
  hot.on("paired:request", request);
  hot.on("vite:ws:connect", hello);
  hello();
  return () => {
    hot.send("paired:bye", { sessionId });
    closed = true;
    hot.off("paired:request", request);
    hot.off("vite:ws:connect", hello);
  };
}
