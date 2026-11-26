# Agent-usability tasks

Each `*.ts` file here is one board task for a fresh agent that has only `AGENT_API.md` and the MCP
tools. A task has a prompt, a setup that builds the starting board on a new page (acting as an
earlier agent or as the person), a `check` that decides from the board alone whether the task was
done, and a reference `solution` used only by the self-test. The agent under test sees only the
prompt; it must not read these files.

```sh
# Every check must fail on the set-up board and pass after the reference solution:
pnpm --filter @pairedcc/canvas exec tsx eval/agent-tasks.ts self-test
# Record an attempt: the runner sets up each task and waits; the agent works through
#   tsx eval/mcp-call.ts list | <tool> '<json>'
# reading the prompt from eval/agent-runs/work/current.json and creating work/done-<task>.
pnpm --filter @pairedcc/canvas exec tsx eval/agent-tasks.ts attempt --agent="description"
```

The attempt is written to `../agent-runs/latest.json`, which `pnpm eval:canvas` reports as the
agent-usability measure. Whoever implements a feature must not write the tasks that test it.
