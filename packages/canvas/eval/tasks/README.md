# Agent-usability tasks

Each `*.json` file here is one board task for a fresh agent that has only `AGENT_API.md` and the
MCP tools. A task has a prompt, an optional setup that runs before the agent starts, and an end state
that is checked by machine, never by the agent's own report.

Whoever implements a feature must not write the tasks that test it. Until tasks and a recorded
attempt (`../agent-runs/latest.json`) exist, the scorecard reports this measure as not run.
