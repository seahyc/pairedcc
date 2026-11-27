// The resident agent: waits for asks made on an open canvas and answers each one with the
// locally installed Claude Code CLI.
//
//   pnpm --filter @pairedcc/canvas agent                         asks from this computer
//   PAIRED_URL=https://paired.cc PAIRED_RESIDENT_SECRET_FILE=… pnpm --filter @pairedcc/canvas agent
//                                                                asks from allowlisted accounts on the hosted site
//
// It uses the same HTTP operations as any external agent (asks/wait, ask_status, answer),
// so nothing here is special-cased in the canvas. The model sees only what the ask shows
// as its context: the question, the selected objects and the frame they sit in.
//
//   PAIRED_URL           canvas server (default http://localhost:5183). Anything but loopback
//                        must be https and needs the server's resident secret.
//   PAIRED_RESIDENT_SECRET_FILE  file holding that secret (or PAIRED_RESIDENT_SECRET)
//   PAIRED_AGENT_NAME    name shown on the board (default Claude)
//   PAIRED_AGENT_MODEL   model alias passed to `claude --model` (default sonnet)
//   PAIRED_CLAUDE_BIN    path to the claude binary (default: found on PATH or in ~/.local/bin)

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt, parseReply, readingNote, systemPrompt, type AskForPrompt } from "./resident-prompt";

const base = process.env.PAIRED_URL ?? "http://localhost:5183";
const secretFile = process.env.PAIRED_RESIDENT_SECRET_FILE;
const secret = (secretFile ? readFileSync(secretFile, "utf8") : (process.env.PAIRED_RESIDENT_SECRET ?? "")).trim();
const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname);
// The secret is only ever sent to a loopback server or over TLS.
if (!local && (new URL(base).protocol !== "https:" || !secret))
  throw new Error("A PAIRED_URL that is not loopback must be https and needs PAIRED_RESIDENT_SECRET_FILE");
const headers = { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) };
const agent = process.env.PAIRED_AGENT_NAME ?? "Claude";
const model = process.env.PAIRED_AGENT_MODEL ?? "sonnet";
const once = process.argv.includes("--once");
const log = (...parts: unknown[]) => console.log(new Date().toISOString(), ...parts);

function findClaude() {
  const candidates = [
    process.env.PAIRED_CLAUDE_BIN,
    ...(process.env.PATH ?? "").split(":").map((dir) => join(dir, "claude")),
    join(homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  return candidates.find((path): path is string => Boolean(path) && existsSync(path!));
}
const claudeBin = findClaude();
// An empty working directory: the model gets no project files, instructions or memory.
const workdir = mkdtempSync(join(tmpdir(), "paired-agent-"));

async function command(sessionId: string, op: string, input: unknown) {
  const response = await fetch(`${base}/api/canvas/command`, {
    method: "POST",
    headers,
    body: JSON.stringify({ requestId: randomUUID(), sessionId, actor: agent, command: { op, input } }),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json()) as { ok?: boolean; result?: unknown; error?: string };
  if (!response.ok || !body.ok) throw new Error(body.error ?? `Canvas returned ${response.status}`);
  return body.result;
}

/** Run Claude Code headlessly: no tools, no MCP servers, no settings, one turn. */
function askClaude(prompt: string) {
  return new Promise<string>((resolve, reject) => {
    if (!claudeBin) return reject(new Error("Claude Code is not installed here (no `claude` on PATH)"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CLAUDE(_CODE|CODE)/.test(key)));
    const child = spawn(
      claudeBin,
      [
        "-p", prompt,
        "--model", model,
        "--system-prompt", systemPrompt,
        "--tools", "",
        "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
        "--setting-sources", "",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--output-format", "json",
      ],
      { cwd: workdir, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "", err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Claude took longer than 90 seconds"));
    }, 90_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (parsed.is_error || typeof parsed.result !== "string") throw new Error(parsed.result || "Claude returned an error");
        resolve(parsed.result);
      } catch (error) {
        const detail = (err || out).trim().split("\n").pop()?.slice(0, 200);
        reject(new Error(code ? `Claude exited with ${code}${detail ? `: ${detail}` : ""}` : error instanceof Error ? error.message : "Unreadable reply from Claude"));
      }
    });
  });
}

async function answer(sessionId: string, ask: AskForPrompt & { id: string }) {
  const started = Date.now();
  try {
    await command(sessionId, "ask_status", { id: ask.id, state: "working", note: readingNote(ask) });
    const reply = parseReply(await askClaude(buildPrompt(ask)));
    await command(sessionId, "answer", {
      id: ask.id,
      read: reply.read,
      ...(reply.kind === "alternatives" ? { alternatives: reply.alternatives!.map((a) => a.slice(0, 400)), ...(reply.dimensions && reply.values ? { dimensions: reply.dimensions, values: reply.values } : {}) } : { text: reply.text!.slice(0, 700), question: reply.kind === "question" }),
    });
    log(`answered ${ask.id} (${reply.kind}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Could not answer").slice(0, 280);
    log(`failed ${ask.id}: ${message}`);
    await command(sessionId, "ask_status", { id: ask.id, state: "failed", error: message }).catch(() => undefined);
  }
}

log(`${agent} is listening for asks at ${base} (model ${model}, claude ${claudeBin ?? "NOT FOUND"})`);
let warned = false;
for (;;) {
  try {
    const response = await fetch(`${base}/api/canvas/asks/wait`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agent, waitMs: 25000 }),
      signal: AbortSignal.timeout(40000),
    });
    if (response.status === 401) throw new Error("the server refused the resident secret");
    if (response.status === 404 && !local) throw new Error("the resident agent is not enabled on that server");
    if (!response.ok) throw new Error(`Canvas returned ${response.status}`);
    const body = (await response.json()) as { sessionId?: string; ask: (AskForPrompt & { id: string }) | null };
    warned = false;
    if (body.ask && body.sessionId) {
      // Answer in the background and go straight back to listening.
      const work = answer(body.sessionId, body.ask);
      if (once) {
        await work;
        break;
      }
    }
  } catch (error) {
    if (!warned) log(`canvas not reachable (${error instanceof Error ? error.message : error}); retrying`);
    warned = true;
    await new Promise((done) => setTimeout(done, 3000));
  }
}
