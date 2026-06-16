/**
 * Comment + tag persistence. Thin wrappers over postgres.js so the route
 * handlers stay declarative and the SQL lives in one place.
 *
 * All reads/writes are doc-scoped; access control (who may see/comment on a
 * doc) is enforced by the route layer before these run, mirroring how
 * documents.ts gates access.
 */

import { sql } from '../db/client.js'
import type { TagTarget } from './logic.js'

export interface CommentRow {
  id: string
  doc_id: string
  block_anchor: string
  quote: string
  body: string
  author_id: string | null
  author_type: 'human' | 'agent'
  status: 'open' | 'resolved'
  assigned_to_agent: boolean
  parent_id: string | null
  created_at: string
  updated_at: string
}

export interface CommentWithTags extends CommentRow {
  tags: TagTarget[]
  replies?: CommentWithTags[]
}

/** Insert a root comment or a reply, plus its @-tags, in one transaction. */
export async function insertComment(input: {
  docId: string
  blockAnchor: string
  quote: string
  body: string
  authorId: string | null
  authorType: 'human' | 'agent'
  parentId: string | null
  assignedToAgent: boolean
  tags: TagTarget[]
}): Promise<CommentRow> {
  // Comment + its tags must land atomically. postgres.js's transaction handle
  // is the same tagged-template callable as `sql`; the published types don't
  // model that (see the identical pattern in db/migrate.ts), so we tag it as
  // `Sql` to keep the template-literal calls type-clean.
  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof sql
    const [row] = await tx<CommentRow[]>`
      INSERT INTO comments
        (doc_id, block_anchor, quote, body, author_id, author_type, parent_id, assigned_to_agent)
      VALUES
        (${input.docId}, ${input.blockAnchor}, ${input.quote}, ${input.body},
         ${input.authorId}, ${input.authorType}, ${input.parentId}, ${input.assignedToAgent})
      RETURNING *
    `
    for (const t of input.tags) {
      await tx`
        INSERT INTO comment_mentions (comment_id, target_type, target)
        VALUES (${row.id}, ${t.target_type}, ${t.target})
        ON CONFLICT (comment_id, target_type, target) DO NOTHING
      `
    }
    return row
  }) as Promise<CommentRow>
}

/** Fetch tags for a set of comment ids, grouped by comment id. */
export async function tagsByComment(commentIds: string[]): Promise<Map<string, TagTarget[]>> {
  const map = new Map<string, TagTarget[]>()
  if (commentIds.length === 0) return map
  const rows = await sql<{ comment_id: string; target_type: 'agent' | 'human'; target: string }[]>`
    SELECT comment_id, target_type, target FROM comment_mentions
    WHERE comment_id = ANY(${commentIds})
  `
  for (const r of rows) {
    const list = map.get(r.comment_id) ?? []
    list.push({ target_type: r.target_type, target: r.target })
    map.set(r.comment_id, list)
  }
  return map
}

/**
 * List root threads for a doc (optionally filtered by status) with their
 * replies and tags attached. Roots and replies are both stored in `comments`;
 * roots have parent_id NULL.
 */
export async function listThreads(docId: string, status?: 'open' | 'resolved'): Promise<CommentWithTags[]> {
  const roots = status
    ? await sql<CommentRow[]>`
        SELECT * FROM comments
        WHERE doc_id = ${docId} AND parent_id IS NULL AND status = ${status}
        ORDER BY created_at ASC
      `
    : await sql<CommentRow[]>`
        SELECT * FROM comments
        WHERE doc_id = ${docId} AND parent_id IS NULL
        ORDER BY created_at ASC
      `
  if (roots.length === 0) return []

  const rootIds = roots.map((r) => r.id)
  const replies = await sql<CommentRow[]>`
    SELECT * FROM comments
    WHERE parent_id = ANY(${rootIds})
    ORDER BY created_at ASC
  `

  const allIds = [...rootIds, ...replies.map((r) => r.id)]
  const tagMap = await tagsByComment(allIds)
  const withTags = (r: CommentRow): CommentWithTags => ({ ...r, tags: tagMap.get(r.id) ?? [] })

  const repliesByRoot = new Map<string, CommentWithTags[]>()
  for (const rep of replies) {
    const list = repliesByRoot.get(rep.parent_id!) ?? []
    list.push(withTags(rep))
    repliesByRoot.set(rep.parent_id!, list)
  }

  return roots.map((root) => ({ ...withTags(root), replies: repliesByRoot.get(root.id) ?? [] }))
}

/** Fetch a single comment by id, scoped to a doc. */
export async function getComment(docId: string, id: string): Promise<CommentRow | null> {
  const [row] = await sql<CommentRow[]>`
    SELECT * FROM comments WHERE id = ${id} AND doc_id = ${docId}
  `
  return row ?? null
}

/** Set status (resolve/reopen) on a root thread. Returns the updated row. */
export async function setStatus(docId: string, id: string, status: 'open' | 'resolved'): Promise<CommentRow | null> {
  const [row] = await sql<CommentRow[]>`
    UPDATE comments SET status = ${status}, updated_at = now()
    WHERE id = ${id} AND doc_id = ${docId} AND parent_id IS NULL
    RETURNING *
  `
  return row ?? null
}

/** Toggle the assign-to-agent flag on a root thread. */
export async function setAssigned(docId: string, id: string, assigned: boolean): Promise<CommentRow | null> {
  const [row] = await sql<CommentRow[]>`
    UPDATE comments SET assigned_to_agent = ${assigned}, updated_at = now()
    WHERE id = ${id} AND doc_id = ${docId} AND parent_id IS NULL
    RETURNING *
  `
  return row ?? null
}

/**
 * Agent inbox: open root threads in a doc assigned to the agent, with tags.
 * Current block text is attached by the route (it owns the DocManager).
 */
export async function listAgentInbox(docId: string, status: 'open' | 'resolved' | 'all'): Promise<CommentWithTags[]> {
  const rows = status === 'all'
    ? await sql<CommentRow[]>`
        SELECT * FROM comments
        WHERE doc_id = ${docId} AND parent_id IS NULL AND assigned_to_agent = true
        ORDER BY created_at ASC
      `
    : await sql<CommentRow[]>`
        SELECT * FROM comments
        WHERE doc_id = ${docId} AND parent_id IS NULL AND assigned_to_agent = true AND status = ${status}
        ORDER BY created_at ASC
      `
  if (rows.length === 0) return []
  const tagMap = await tagsByComment(rows.map((r) => r.id))
  return rows.map((r) => ({ ...r, tags: tagMap.get(r.id) ?? [] }))
}
