import type { CommentTag } from './api'

/**
 * Mirror of the server's tag parsing (packages/server/src/comments/logic.ts)
 * so the composer can preview detected @-tags and pass structured ones. Kept
 * deliberately tiny and in sync by hand — the surface is small.
 */
export const AGENT_TAG_NAMES = new Set(['agent', 'claude'])

export function parseTags(body: string): CommentTag[] {
  const out: CommentTag[] = []
  const seen = new Set<string>()
  const re = /(?:^|[^\w@])@([a-zA-Z0-9][a-zA-Z0-9_.-]{0,127})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const name = m[1].replace(/[.\-_]+$/, '')
    if (!name) continue
    const isAgent = AGENT_TAG_NAMES.has(name.toLowerCase())
    const key = `${isAgent ? 'agent' : 'human'}:${name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ target_type: isAgent ? 'agent' : 'human', target: name })
  }
  return out
}

export function tagsAssignAgent(tags: CommentTag[]): boolean {
  return tags.some((t) => t.target_type === 'agent')
}
