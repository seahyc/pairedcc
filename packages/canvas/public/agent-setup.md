# Connect to Paired

You are an AI agent. Your user wants you to work with them on Paired (https://paired.cc), a canvas where they think and you help: you lay out options, they judge them with a pen.

Do every step yourself by running the commands. Ask the user only to approve the sign-in page in their browser and, if your client needs it, to restart you.

Paired's MCP server is `https://paired.cc/mcp`. It uses OAuth: the first time you connect, a browser page asks the user to sign in to Paired and allow you. There are no API keys to copy.

## 1. Add the MCP server

Use the section for your client.

### Claude Code

```sh
claude mcp add --transport http --scope user paired https://paired.cc/mcp
```

Then ask the user to run `/mcp` in Claude Code, choose `paired`, and authenticate. A browser page opens for them to sign in and allow access.

### Codex

```sh
codex mcp add paired --url https://paired.cc/mcp
codex mcp login paired
```

`codex mcp login` opens the sign-in page in the user's browser.

### Cursor

Add this to `~/.cursor/mcp.json` (create the file if it does not exist, and keep any servers already in it):

```json
{ "mcpServers": { "paired": { "url": "https://paired.cc/mcp" } } }
```

Then ask the user to open Cursor Settings → MCP and log in to `paired` there.

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`, or the user-level `mcp.json`:

```json
{ "servers": { "paired": { "type": "http", "url": "https://paired.cc/mcp" } } }
```

### Windsurf / Devin Desktop

Add to `~/.codeium/windsurf/mcp_config.json` (note `serverUrl`, not `url`):

```json
{ "mcpServers": { "paired": { "serverUrl": "https://paired.cc/mcp" } } }
```

### OpenCode

Add to `~/.config/opencode/opencode.jsonc` under `"mcp"`:

```json
{ "paired": { "type": "remote", "url": "https://paired.cc/mcp", "oauth": {} } }
```

Then run `opencode mcp auth paired`.

### Claude.ai or ChatGPT

These are set up by the user in the browser, not by you. Tell them:

- Claude.ai: Settings → Connectors → Add custom connector → `https://paired.cc/mcp`.
- ChatGPT: Settings → Apps → Advanced → turn on Developer mode, then create an app with the URL `https://paired.cc/mcp`.

### Any other MCP client

Add a remote (Streamable HTTP) server at `https://paired.cc/mcp` with OAuth. If the client only supports stdio servers, use `npx -y mcp-remote@latest https://paired.cc/mcp` as the command.

## 2. Open the canvas

The board lives in the user's browser, so a Paired tab must be open while you work. Ask the user to open https://paired.cc/ and sign in there with the same account they approved you with. The "Agent access" button shows a green dot when the tab is ready.

## 3. Check the connection

Call `canvas_sessions`. You should see at least one open canvas. Then call `canvas_read` and tell the user, in a sentence, what is on their board.

If `canvas_sessions` is empty, the tab is closed or signed in to a different account. If tools are missing, ask the user to restart you so the new server loads.

## 4. How to work on the board

- Read before you write, and keep what the human made.
- Read back how you understood their question before acting.
- Put options side by side, each with a small picture and a one-line caption.
- Give your view, then hand decisions back as short numbered questions.
- The human answers with marks: P picks, X rejects, a pen circle or a pink note. `canvas_read` returns open marks; resolve each one with `canvas_resolve` once you've acted on it.
- Never mark picks or rejects yourself. Your work is shown in casual typed lavender with ✦; theirs is handwritten pink.
- Pick a note style for what you write: `heading` for section titles, `quote` for excerpts from a source (say where it came from), `code` for numbers and data, and the default `note` for everything else.

When everything works, print:

```
Paired is connected.
  MCP server: https://paired.cc/mcp
  Canvas: open in your browser
Try: "Read my Paired board and give me three ways to think about it."
```

This file is published at https://paired.cc/agent-setup.md.
