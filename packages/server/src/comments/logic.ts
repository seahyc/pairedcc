/**
 * Pure comment + tag logic — no DB, no Yjs, no Hono. Kept dependency-free so
 * the validation, size limits, and @-tag parsing can be unit-tested directly
 * and reused by both the human and agent comment routes.
 *
 * paired.cc accepts arbitrary text from the public internet (anonymous docs,
 * markdown import, comments, tags), so every public write path runs through
 * these guards before it touches Postgres.
 */

/** Hard caps on public-input field sizes. Oversized requests are rejected
 *  (400) rather than truncated, so the client knows the write didn't fully
 *  land. Chosen generously enough for real prose, tight enough to bound abuse. */
export const LIMITS = {
  /** Comment / reply body. ~8k chars is a long paragraph, well past normal use. */
  COMMENT_BODY: 8_000,
  /** Block-text quote snapshot stored alongside a comment. */
  COMMENT_QUOTE: 4_000,
  /** Markdown import blob. 256k chars ≈ a large document, not a dump. */
  MARKDOWN_IMPORT: 256_000,
  /** Document / comment title-ish strings. */
  TITLE: 500,
  /** Max @-tags persisted per comment (prevents tag-spam fan-out). */
  TAGS_PER_COMMENT: 32,
} as const

/**
 * Parse a request JSON body, returning `{}` on any error/non-object. Typed so
 * callers read fields as `unknown` (then validate) without the union widening
 * a `.catch(() => ({}))` introduces.
 */
export async function safeJson(req: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const v = await req.json()
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True for a canonical UUID string (doc ids, comment ids). */
export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}

export type CommentStatus = 'open' | 'resolved'
export function isStatus(s: unknown): s is CommentStatus {
  return s === 'open' || s === 'resolved'
}

/**
 * A block anchor for a comment is a non-empty text snippet of the block's
 * content (the `editByAnchor` contract) OR a `b-…` ComponentBlock anchor.
 * Bound it so a comment can't be anchored to a megabyte of "anchor" text.
 */
export function isValidBlockAnchor(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= 2_000
}

export interface ValidatedBody {
  ok: true
  value: string
}
export interface InvalidBody {
  ok: false
  error: string
  /** Suggested HTTP status: 400 for malformed, 413 for too large. */
  status: 400 | 413
}

/** Validate + normalize a comment/reply body against the size cap. */
export function validateBody(raw: unknown): ValidatedBody | InvalidBody {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Body must be a string.', status: 400 }
  }
  const value = raw.trim()
  if (value.length === 0) {
    return { ok: false, error: 'Comment body must not be empty.', status: 400 }
  }
  if (raw.length > LIMITS.COMMENT_BODY) {
    return { ok: false, error: `Comment body exceeds ${LIMITS.COMMENT_BODY} characters.`, status: 413 }
  }
  return { ok: true, value }
}

export interface TagTarget {
  target_type: 'agent' | 'human'
  target: string
}

/**
 * The set of names that route a comment to the AGENT inbox when @-tagged.
 * Mirrors the inline-mention agent list (currently just "claude"); kept here
 * so the comment composer and the server agree on what "tag the agent" means.
 */
export const AGENT_TAG_NAMES = new Set(['agent', 'claude'])

/**
 * Parse @-tags out of a comment body. Recognizes `@name` tokens (letters,
 * digits, `_`, `-`, `.`). A tag whose name is an agent name (see
 * AGENT_TAG_NAMES) becomes an `agent` target — this is what flips
 * `assigned_to_agent`. Everything else is a `human` target (collaborator
 * handle / id). De-duplicates and bounds the count.
 *
 * Explicit `extra` targets (e.g. a structured pick from the autocomplete UI)
 * are merged in and de-duplicated the same way.
 */
export function parseTags(body: string, extra: TagTarget[] = []): TagTarget[] {
  const out: TagTarget[] = []
  const seen = new Set<string>()
  const push = (t: TagTarget) => {
    const name = t.target.trim().replace(/^@/, '')
    if (!name) return
    // Bound individual tag length so a tag can't smuggle a huge string.
    if (name.length > 128) return
    const key = `${t.target_type}:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ target_type: t.target_type, target: name })
  }

  // `@name` where name starts with a word char. Trailing punctuation (.,!?) is
  // excluded by stopping the class before it; an interior dot/dash is allowed.
  const re = /(?:^|[^\w@])@([a-zA-Z0-9][a-zA-Z0-9_.-]{0,127})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const name = m[1].replace(/[.\-_]+$/, '') // drop trailing punctuation
    if (!name) continue
    const isAgent = AGENT_TAG_NAMES.has(name.toLowerCase())
    push({ target_type: isAgent ? 'agent' : 'human', target: name })
  }
  for (const t of extra) push(t)

  return out.slice(0, LIMITS.TAGS_PER_COMMENT)
}

/** Does this tag set route the comment to the agent inbox? */
export function tagsAssignAgent(tags: TagTarget[]): boolean {
  return tags.some((t) => t.target_type === 'agent')
}
