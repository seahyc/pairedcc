# paired.cc — Market Research

## Origin

Born from an 8-hour DD drafting session where Claude Code + Yingcong + Oswald co-edited markdown via HackMD. Pain: full-doc replacement on every sync, CLI silently fails, LaTeX eats dollar signs, no way to see what the human is looking at, no @-mentions between human and agent.

## The Problem

No tool exists where humans and AI agents can co-edit documents in real-time across common formats, with agents as first-class participants (cursors, presence, context-aware edits).

Current state splits into two broken patterns:
- **Pattern A**: Real-time collab, no AI agency (Google Docs, Confluence)
- **Pattern B**: AI assistance, no real-time collab (ChatGPT Canvas, Claude Projects)

## Competitive Landscape

### Direct competitors (AI-as-peer in documents): Almost nobody

| Player | What it does | Gap |
|--------|-------------|-----|
| **Draftflow** | Open-source CRDT editor, AI corrects writing as another cursor (Yjs + Quill + OpenAI) | Tiny hobby project, single-user cleanup only, no multi-agent, no comments/mentions |
| **Liveblocks** ($6.4M raised) | Infrastructure/SDK for embedding AI agents into collaborative apps | Platform, not end-user product. Could build ON this or compete WITH it |
| **Pairit** | Research platform for human-AI team collaboration | Academic prototype only |

### Adjacent competitors (AI bolted onto docs)

| Player | AI model | Limitation |
|--------|----------|------------|
| **Google Docs + Gemini** | Sidebar assistant, Help Me Write | No cursor/presence, no agent API, locked to Gemini |
| **Microsoft Copilot + Word** | Inline generation, rewrite | $30/seat/mo, enterprises can't prove ROI |
| **Notion AI** | Inline generate/summarize | Lossy markdown, no real agent API, single-model |
| **ChatGPT Canvas** | Side-by-side editing | Single user + single AI, no collaboration |
| **Claude Projects** | File-based context | No shared document state, no real-time co-editing |

### Infrastructure players

| Player | What | Relevance |
|--------|------|-----------|
| **Tiptap** | ProseMirror-based collaborative editor framework | Could be our markdown renderer |
| **ONLYOFFICE** (AGPL 3.0) | Full browser editing of docx/xlsx/pptx with real-time collab | Could be our Office format renderer |
| **Yjs** | CRDT library for real-time collaboration | Our collaboration layer |

## Market Size

| Segment | Size (2026) | CAGR |
|---------|-------------|------|
| Enterprise Collaboration (broad) | $85.8B | 12.7% |
| AI Writing Assistant Software | ~$2.74B → $10.3B by 2032 | 24.8% |
| AI Agent Market | $7.84B → $52.6B by 2030 | 46.3% |
| **paired.cc addressable slice** | **$3–6B** | **~30%** |

## Comparable Companies

| Company | What they proved | Revenue | Raised |
|---------|-----------------|---------|--------|
| **Notion** | Knowledge workers pay for blocks + collab | $600M ARR | $537M |
| **Figma** | Multiplayer is a wedge that sells itself | $600M+ ARR | Acquired $20B |
| **Hex** | Data teams pay for interactive collaborative notebooks | $19.8M ARR | $172M |
| **Overleaf** | Academics pay for collaborative LaTeX | $9.1M ARR, 19M users | $5.7M |
| **Mintlify** | Devs pay for beautiful markdown tooling (PLG) | $10M ARR | $21M |
| **Obsidian** | 1.5M users want markdown, local-first | $2M ARR | $0 raised, 18 people |
| **HackMD** | Collaborative markdown is a small market if you stop there | Tiny | $270K |

## Key Market Signals

- Gartner logged a **1,445% surge** in multi-agent system inquiries Q1 2024 → Q2 2025
- 40% of enterprise apps will feature task-specific AI agents by end of 2026 (Gartner)
- 75% of developers expected to use MCP servers for AI tools by 2026
- 93% of US IT executives express strong interest in agentic AI; 32% plan to invest within 6 months
- 37% of time saved by AI is lost to rework (Workday, 3,200 employees) — the "dump and fix" model is broken
- Microsoft Copilot: half of technology leaders couldn't justify cost after a full year

## Segment Analysis

### Who has this pain? (Ranked by lucrativeness)

**Tier 1 — Wedge market (PLG, self-serve)**
- Technical founders doing DD, investor updates, board decks
- Developer advocates / DevRel writing docs synced with code
- Data teams writing reports from live dashboards/DBs
- Small technical teams already using Claude Code + MCP

**Tier 2 — Expansion markets (sales-assisted)**
- RevOps / Sales Engineering (proposals, SOWs, RFP responses)
- Strategy consulting (collaborative client deliverables)
- FP&A / board reporting

**Tier 3 — Enterprise (sales-led, long cycle)**
- Legal M&A due diligence
- Pharma / regulatory submissions
- Investment banking

## The Real Pain (From Our Own Experience)

The pain is NOT "document collaboration is broken." It's:

**"My AI agent has deep context (codebase, database, MCP tools) and I need it to co-edit documents with people who use different formats."**

Key ingredients:
1. The AI agent's value comes from its *context* (code, DB, MCP) — not just language skills
2. Partners/collaborators use various formats (Google Docs, PowerPoint, LaTeX, markdown)
3. The agent can't be in there as a peer — can't see selections, can't do surgical edits, can't leave anchored comments

## What Makes This Different From Notion AI / Gemini in Docs

| Capability | Notion AI / Gemini | paired.cc |
|-----------|-------------------|-----------|
| "Summarize this paragraph" | Yes | Yes (commodity) |
| "Pull Q3 revenue from my database" | No — no DB access | Yes — agent has MCP |
| "Update code examples to match main branch" | No — no codebase access | Yes — agent has codebase context |
| Agent sees what you're highlighting | No | Yes |
| Anchored comments from AI | No — AI output is ephemeral | Yes — threaded, resolvable |
| @agent in the doc with context | Only their model, no MCP | Any agent, any model, any tools |
| Render interactive charts/viz inline | No | Yes — sandboxed React components |
| Open a .pptx and have agents edit it | No | Yes — via ONLYOFFICE renderer |

## Community & Research Validation

- arXiv paper (2509.11826): 30 participants, 14 teams studied collaborative editing with multiple AI agents — first research on this exact problem
- Pairit experiment (2,310 participants): human-AI teams increased communication 63%, humans did 71% less direct editing
- HackMD API: full-doc replacement only, updates don't reliably update all lines (GitHub issue #86), rate limited to 2000 calls/month

## UX Decision: No Split Pane

Split-pane markdown (HackMD-style) is dated. Modern approaches:
- **Live preview** (Typora, Obsidian): markdown syntax hides when cursor moves away
- **Hybrid WYSIWYG** (Tiptap/ProseMirror): WYSIWYG editing that outputs clean markdown

paired.cc uses Tiptap/ProseMirror hybrid WYSIWYG — what Notion, Linear, GitBook are built on.

## Sources

- [Draftflow - CRDT-aware Editor AI](https://vishnugopal.com/2025/02/04/draftflow-a-collaborative-crdt-aware-editor-ai/)
- [Liveblocks AI Agents](https://liveblocks.io/ai-agents)
- [arXiv: Collaborative Document Editing with Multiple Users and AI Agents](https://arxiv.org/abs/2509.11826)
- [arXiv: Collaborating with AI Agents - Field Experiment](https://arxiv.org/abs/2503.18238)
- [Enterprise Collaboration Market - MarketsandMarkets](https://www.marketsandmarkets.com/PressReleases/enterprise-collaboration.asp)
- [AI Writing Assistant Software Market](https://www.businesswire.com/news/home/20260108081428/en/)
- [AI Agent Statistics 2026](https://masterofcode.com/blog/ai-agent-statistics)
- [Notion: $600M ARR](https://www.saastr.com/notion-and-growing-into-your-10b-valuation-a-masterclass-in-patience/)
- [Obsidian: $2M revenue, 1.5M users](https://getlatka.com/companies/obsidian.md)
- [Mintlify: $10M ARR](https://sacra.com/c/mintlify/)
- [Hex: $19.8M ARR, $172M raised](https://getlatka.com/companies/hex)
- [Overleaf: $9.1M ARR, 19M users](https://getlatka.com/companies/overleaf.com)
- [ONLYOFFICE DocumentServer](https://github.com/ONLYOFFICE/DocumentServer)
- [TeXlyre - Yjs CRDT LaTeX](https://texlyre.github.io/)
- [Tiptap Collaboration](https://tiptap.dev/product/collaboration)
- [HackMD CLI Issue #86](https://github.com/hackmdio/hackmd-cli/issues/86)
- [Gartner: AI Agents in Enterprise](https://www.gartner.com/en/newsroom/press-releases/2025-08-26)
- [State of AI in Enterprise - Deloitte](https://www.deloitte.com/us/en/what-we-do/capabilities/applied-artificial-intelligence/content/state-of-ai-in-the-enterprise.html)
- [PLG in 2026 Playbook](https://www.news.aakashg.com/p/plg-in-2026)
- [Figma PLG](https://www.ptengine.com/blog/business-strategy/figma-product-led-growth-how-a-design-tool-took-over-the-world/)
