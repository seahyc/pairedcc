import { api } from '../api'

export interface CommentTag {
  target_type: 'agent' | 'human'
  target: string
}

export interface Comment {
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
  tags: CommentTag[]
  replies?: Comment[]
}

/** List threads for a doc, optionally filtered by status. */
export function listComments(docId: string, status?: 'open' | 'resolved'): Promise<Comment[]> {
  const q = status ? `?status=${status}` : ''
  return api<Comment[]>(`/api/documents/${docId}/comments${q}`)
}

/** Create a thread anchored to a block. `tags` come from the composer's @-picks. */
export function createComment(
  docId: string,
  input: { block_anchor: string; quote: string; body: string; tags?: CommentTag[] },
): Promise<Comment> {
  return api<Comment>(`/api/documents/${docId}/comments`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function replyComment(
  docId: string,
  commentId: string,
  input: { body: string; tags?: CommentTag[] },
): Promise<Comment> {
  return api<Comment>(`/api/documents/${docId}/comments/${commentId}/reply`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function resolveComment(docId: string, commentId: string): Promise<Comment> {
  return api<Comment>(`/api/documents/${docId}/comments/${commentId}/resolve`, { method: 'POST' })
}

export function reopenComment(docId: string, commentId: string): Promise<Comment> {
  return api<Comment>(`/api/documents/${docId}/comments/${commentId}/reopen`, { method: 'POST' })
}

export function assignAgent(docId: string, commentId: string, assigned: boolean): Promise<Comment> {
  return api<Comment>(`/api/documents/${docId}/comments/${commentId}/assign-agent`, {
    method: 'POST',
    body: JSON.stringify({ assigned }),
  })
}
