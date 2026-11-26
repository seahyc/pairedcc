// Pull the human's feedback queue out of every open canvas tab on this computer.
//
//   pnpm --filter @pairedcc/canvas feedback            readable Markdown
//   pnpm --filter @pairedcc/canvas feedback --json     full JSON (items, counts, notes)
//   pnpm --filter @pairedcc/canvas feedback --open     only open items
//
// The board lives in the browser, so a canvas tab must be open (http://localhost:5183).

const base = process.env.PAIRED_URL ?? "http://localhost:5183";
const json = process.argv.includes("--json");
const which = process.argv.includes("--open") ? "open" : "all";

const listed = (await (await fetch(`${base}/api/canvas/sessions`)).json()) as { sessions: { id: string; title: string }[] };
const wanted = process.env.PAIRED_SESSION;
const sessions = listed.sessions.filter((s) => !wanted || s.id === wanted);
if (!sessions.length) {
  console.error(`No open canvas tab found at ${base}. Open it in the browser where the feedback was left, then run this again.`);
  process.exit(1);
}

const boards = [];
for (const session of sessions) {
  const response = await fetch(`${base}/api/canvas/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: `pull-feedback-${Date.now()}-${session.id.slice(0, 8)}`,
      sessionId: session.id,
      actor: "Feedback export",
      command: { op: "feedback", input: { status: which, format: "markdown" } },
    }),
  });
  const body = (await response.json()) as { ok?: boolean; error?: string; result?: { markdown: string; notes: { text: string; pageName: string; createdAt: string; id: string }[] } };
  if (!response.ok || !body.ok || !body.result) {
    console.error(`Session ${session.id}: ${body.error ?? response.status}`);
    process.exitCode = 1;
    continue;
  }
  boards.push({ sessionId: session.id, ...body.result });
}

if (json) console.log(JSON.stringify(boards.length === 1 ? boards[0] : boards, null, 2));
else
  for (const board of boards) {
    if (boards.length > 1) console.log(`<!-- canvas session ${board.sessionId} -->`);
    console.log(board.markdown);
    if (board.notes.length) {
      console.log(`## Other notes on the board (${board.notes.length})\n`);
      for (const n of board.notes) console.log(`- ${n.text.replace(/\s*\n\s*/g, " ")} · page "${n.pageName}" · ${n.createdAt} · id ${n.id}`);
      console.log("");
    }
  }
process.exit(process.exitCode ?? 0);
export {};
