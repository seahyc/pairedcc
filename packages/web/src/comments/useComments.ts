import { useCallback, useEffect, useState } from 'react'
import {
  listComments,
  createComment,
  replyComment,
  resolveComment,
  reopenComment,
  assignAgent,
  type Comment,
  type CommentTag,
} from './api'

export interface CommentDraft {
  block_anchor: string
  quote: string
}

/**
 * Owns comment state for a doc: the thread list, a pending "new comment" draft
 * (anchored to a block by the BubbleMenu button), and the mutating actions.
 * The sidebar and the editor both read/write through this single hook so the
 * gutter dots, the open sidebar, and the composer stay in sync.
 */
export function useComments(docId: string) {
  const [threads, setThreads] = useState<Comment[]>([])
  const [draft, setDraft] = useState<CommentDraft | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setThreads(await listComments(docId))
    } catch {
      // Doc may be private/unauthorized; leave threads empty.
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => { void refresh() }, [refresh])

  /** Anchor a brand-new thread to a block and open the sidebar to compose it. */
  const startDraft = useCallback((d: CommentDraft) => {
    setDraft(d)
    setOpen(true)
  }, [])

  const submitDraft = useCallback(async (body: string, tags: CommentTag[]) => {
    if (!draft) return
    await createComment(docId, { ...draft, body, tags })
    setDraft(null)
    await refresh()
  }, [docId, draft, refresh])

  const reply = useCallback(async (commentId: string, body: string, tags: CommentTag[]) => {
    await replyComment(docId, commentId, { body, tags })
    await refresh()
  }, [docId, refresh])

  const resolve = useCallback(async (commentId: string) => {
    await resolveComment(docId, commentId)
    await refresh()
  }, [docId, refresh])

  const reopen = useCallback(async (commentId: string) => {
    await reopenComment(docId, commentId)
    await refresh()
  }, [docId, refresh])

  const toggleAssign = useCallback(async (commentId: string, assigned: boolean) => {
    await assignAgent(docId, commentId, assigned)
    await refresh()
  }, [docId, refresh])

  /** Anchors of all blocks that have at least one OPEN thread (for gutter dots). */
  const commentedAnchors = threads
    .filter((t) => t.status === 'open')
    .map((t) => t.block_anchor)

  return {
    threads,
    draft,
    open,
    loading,
    setOpen,
    setDraft,
    startDraft,
    submitDraft,
    reply,
    resolve,
    reopen,
    toggleAssign,
    refresh,
    commentedAnchors,
  }
}
