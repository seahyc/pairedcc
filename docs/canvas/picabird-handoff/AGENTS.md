# Agent guide for Picabird

Read this first, then `STATUS.md`. Keep both current, because they are how agents hand work to each other.

## Thinking canvas specification (YC, 2026-11-17)

YC is specifying a new rich thinking canvas within Picabird. Preserve the existing data API and shopping research. YC authorised a local canvas-foundation prototype on 2026-11-17, prioritising smooth editing. Canvas code is in `canvas/`; broader product specifications continue. Local HTTP/MCP access is implemented; see `canvas/AGENT_API.md` for per-tab connection, real verification scripts and development-only limitations. Both a built-in assistant and external agents are required from day one, with shared object operations. See `research/notes/2026-11-17-thinking-canvas-working-spec.md`; proposals in that document are not approved requirements.

Canvas may contain explicitly distinguished human notes, agent interpretations and generated artifacts. Do not copy employer data into this project.

## Existing data API (recorded 2026-11-04)
A **live-data-for-agents API**. An agent asks a question in natural language or as filters. Picabird queries official public sources and returns compact, typed records. Each record carries field-level provenance (official URL, `retrieved_at`, the source's own update time). Watches send changes via webhook. The brand is a magpie that finds hidden, shiny things. It should feel friendly, never creepy.

The original consumer-fiduciary shopping thesis (rank-blind shortlists, see `README.md`) is **parked, not dropped**. Shopping appears on the site as one of six use cases. See `STATUS.md` → Decisions.

## Where things live
| Path | What | Who edits |
|---|---|---|
| `STATUS.md` | Current state, open threads, decisions, session log | Every agent, at the end of a work session |
| `research/INDEX.md` | Catalogue of every research file with status (current / parked / superseded) | Anyone adding or retiring a note |
| `research/notes/` | Dated working notes `YYYY-MM-DD-topic.md` | Append a new note rather than rewriting someone else's conclusions |
| `research/private/` | **Gitignored.** Founder chats, Gemini transcripts, YC's shopping history | Never publish, quote on the site, or send to third parties |
| `research/dossier/`, `research/agent-shopping-pain/` | Shopping-thesis research (2026-11-03) | Parked |
| `canvas/` | Local React/tldraw thinking-canvas prototype; `canvas/README.md` has setup and verification | Builders |
| `website/` | Landing page (`public/`) + API Worker (`src/`), deployed as one Cloudflare Worker | Builders |
| `scraper/` | Source rules for evidence collection | Read before adding any source |

## Positioning (YC, 2026-11-04)
- **Buyers are agent-native companies.** They judge us on **completeness, accuracy, speed, coverage, token efficiency and domain-specific capabilities**. Every page and section should speak to those axes.
- **Prove it live.** Show interactive examples and numbers measured by real calls in the visitor's browser (e.g. raw source bytes vs ours, latency, field-by-field verification against the source, our total vs the source's own count).
- **Sell buyer benefits.** Site copy doesn't discuss terms of service, licensing, "lawful sources" or what we don't scrape. We still follow each source's rules internally; we just don't market it.
- **Promising just beyond what's proven is fine when it's clearly feasible** (watches with diffs, an MCP server, more sources), labelled "coming" or "early access".

## Rules
- **No invented numbers:** no SOC2, customer, scale or benchmark figures we haven't measured. Live-measured numbers are good. Label examples as examples.
- **Only lawful sources:** official APIs and published files, within their terms. No getting around bot walls, captchas or logins (ERCOT's site is behind Incapsula, so use its registered API).
- **Ask YC before** outreach, spending money, publishing, `git init`, or deploying a new public surface.
- **Secrets** live in the agent-vault (Bitwarden, gmail account). Never in files, chat or args. Cloudflare goes through `cfw personal/r2-dns` (passkey-approved plans).

## Handoff protocol
1. **Starting:** read `STATUS.md` (open threads + last log entries) and the notes it links to.
2. **New research:** write it to `research/notes/YYYY-MM-DD-topic.md`. Start with a 1–3 line **Summary** and a **Status** line (`current`, `superseded by X`, `parked`). Add a row to `research/INDEX.md`.
3. **Finishing:** add one dated entry to the session log in `STATUS.md` (what changed, where, what's next, session ID if known) and update Open threads. Keep entries to about 5 lines; link out for detail.
4. **Changing a decision:** record it under Decisions with the date and the reason. Don't silently edit old notes; mark them superseded.
