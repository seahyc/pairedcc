# Picabird

Picabird is exploring a **rich thinking canvas** for research, understanding, learning and data analysis, inspired by tldraw/Figma/Paper/Miro. Both built-in and external agents are day-one requirements. See the [working specification](research/notes/2026-11-17-thinking-canvas-working-spec.md); a local canvas-foundation prototype is now available in [`canvas/`](canvas/README.md), while broader specifications continue.

The existing implementation is a **live-data-for-agents API**: compact sourced records drawn from official public data, plus a landing page in `website/`. Existing code and shopping research are preserved. Agents start at `AGENTS.md`, then `STATUS.md`.

## Original thesis (parked 2026-11-04, see STATUS.md → Decisions)

Consumer-fiduciary shopping research for agents: a curated, method-published shortlist per category that agents call over MCP. Ranking is rank-blind: nobody can pay to be included or ranked.

**Master Plan:** Curate one category better than anyone; use trust to win the agents; use their purchases to earn verified outcomes; use outcomes to guarantee purchases; use guarantees to become how agents buy.

**Mission:** help the best product win, regardless of brand or distribution.

## Layout

| Path | What |
|---|---|
| `website/` | Landing page (`public/`) + API Worker (`src/`), one Cloudflare Worker |
| `scraper/` | Evidence collection pipeline (lawful sources only, see its README) |
| `research/dossier/` | Copy of the 2026-11-03 agentic-commerce dossier. The canonical copy stays in `seahyc.github.io/research-dossiers/` |
| `research/notes/` | Dated working notes. Catalogue with status: `research/INDEX.md` |
| `research/private/` | **Gitignored.** Founder chats, the Gemini ideation transcript and YC's personal shopping history. Never publish |

## Non-negotiables
- No pay-to-rank, no sponsored placement, no auctions. Excluding a product needs a buyer-fit, evidence or safety reason.
- Publish the selection method and its version.
- No scraping that violates terms. No fake reviews. No employer (Glints) data.
- Ask before any outreach, purchase or spend.

## Status
See `STATUS.md`.
