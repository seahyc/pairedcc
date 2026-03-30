---
name: pairedcc
description: >
  Collaborate on documents in real-time on paired.cc. Use when the user wants to
  co-edit a document with you, or when you need to read/edit a shared document
  on paired.cc. Triggers: "edit paired doc", "join document", "paired.cc",
  "co-edit", "collaborate on doc", "@mentions in doc".
homepage: https://github.com/seahyc/pairedcc
metadata:
  clawdbot:
    emoji: "📝"
    requires:
      bins: ["pairedcc"]
    install:
      - id: npm
        kind: node
        package: "pairedcc"
        bins: ["pairedcc"]
        label: "Install paired.cc CLI (npm)"
---

# paired.cc

Collaborative documents where AI agents are first-class participants. You appear as a live cursor in the document alongside humans.

## Quick Start

If the `pairedcc` CLI is not installed, install it first:

```bash
npm i -g pairedcc
```

## Commands

### Join a document as a live collaborator

```bash
pairedcc join <doc-id> --key <api-key>
```

You appear as a cursor in the document. Other participants see your edits in real-time.

### Watch for @-mentions

```bash
pairedcc watch <doc-id> --key <api-key>
```

Polls for @-mentions directed at you. When a human types `@claude` in the doc, you receive the mention with surrounding context.

### Make a surgical edit

```bash
pairedcc edit <doc-id> <anchor-text> <new-content> --key <api-key>
```

Find text matching `anchor-text` in the document and replace it with `new-content`. The anchor is resolved at apply-time, so concurrent edits don't cause offset drift.

## Getting an API Key

1. Visit https://paired.cc and sign in
2. Go to Settings > API Keys
3. Create a key with a label (e.g., "claude-code")
4. The key starts with `pcc_`

Or ask the user to share their API key with you.

## Environment Variables

Set these to avoid passing `--key` on every command:

```bash
export PAIREDCC_API_KEY=pcc_your-key-here
export PAIREDCC_URL=https://paired.cc  # default, can override for self-hosted
```

## MCP Server (Alternative)

If you prefer MCP over CLI, the MCP server provides the same functionality as tools:

```json
{
  "mcpServers": {
    "pairedcc": {
      "command": "npx",
      "args": ["pairedcc-mcp-server"],
      "env": {
        "PAIREDCC_API_KEY": "pcc_your-key-here"
      }
    }
  }
}
```

MCP tools: `list_documents`, `read_document`, `edit_document`, `get_mentions`, `respond_to_mention`, `get_presence`.

## Workflow

1. User shares a paired.cc document link with you
2. You join the document with `pairedcc join`
3. You can read the full document content
4. When the user types `@claude` in the doc, you get notified
5. You make edits that appear in real-time with your cursor
6. The user sees your changes live and can respond

## Tips

- Always use `pairedcc watch` in the background to catch @-mentions
- Use semantic anchors for edits (heading text, paragraph starts) — they survive concurrent edits better than line numbers
- Your edits create snapshots with agent attribution, so the user can always revert
