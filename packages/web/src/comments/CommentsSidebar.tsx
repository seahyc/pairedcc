import { useMemo, useState } from 'react'
import type { Comment, CommentTag } from './api'
import { CommentComposer } from './CommentComposer'
import type { useComments } from './useComments'

type CommentsApi = ReturnType<typeof useComments>

interface Props {
  comments: CommentsApi
  /** Known collaborators for the @-autocomplete (best-effort; may be empty). */
  collaborators: { id: string; name: string }[]
  /** Focus a block in the editor when its thread is clicked. */
  onFocusBlock?: (blockAnchor: string) => void
}

const AGENT_SUGGESTION = { target_type: 'agent' as const, target: 'agent' }

/** Render a comment body with @-tags subtly highlighted. Body is rendered as
 *  TEXT (never HTML) — React escapes it — so untrusted comment content cannot
 *  inject markup. We only wrap recognized @tokens in a styled span. */
function CommentBody({ body }: { body: string }) {
  const parts = body.split(/(\s+)/)
  return (
    <p className="comment-body">
      {parts.map((p, i) =>
        /^@[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(p)
          ? <span key={i} className="comment-tag">{p}</span>
          : <span key={i}>{p}</span>,
      )}
    </p>
  )
}

function Tags({ tags }: { tags: CommentTag[] }) {
  if (!tags || tags.length === 0) return null
  return (
    <div className="comment-tags">
      {tags.map((t) => (
        <span key={`${t.target_type}:${t.target}`} className={`comment-tag-chip ${t.target_type}`}>
          @{t.target}
        </span>
      ))}
    </div>
  )
}

function Thread({ thread, comments, suggestions, onFocusBlock }: {
  thread: Comment
  comments: CommentsApi
  suggestions: { target_type: 'agent' | 'human'; target: string }[]
  onFocusBlock?: (anchor: string) => void
}) {
  const [replying, setReplying] = useState(false)

  return (
    <div className={`comment-thread ${thread.status}`}>
      <button className="comment-quote" onClick={() => onFocusBlock?.(thread.block_anchor)} title="Jump to block">
        “{thread.quote || thread.block_anchor}”
      </button>
      <div className="comment-root">
        <div className="comment-meta">
          <span className={`comment-author ${thread.author_type}`}>
            {thread.author_type === 'agent' ? `🤖 ${thread.author_id || 'agent'}` : 'You / collaborator'}
          </span>
          {thread.assigned_to_agent && <span className="comment-assigned">assigned to agent</span>}
        </div>
        <CommentBody body={thread.body} />
        <Tags tags={thread.tags} />
      </div>

      {thread.replies && thread.replies.length > 0 && (
        <div className="comment-replies">
          {thread.replies.map((r) => (
            <div key={r.id} className="comment-reply">
              <div className="comment-meta">
                <span className={`comment-author ${r.author_type}`}>
                  {r.author_type === 'agent' ? `🤖 ${r.author_id || 'agent'}` : 'You / collaborator'}
                </span>
              </div>
              <CommentBody body={r.body} />
              <Tags tags={r.tags} />
            </div>
          ))}
        </div>
      )}

      <div className="comment-thread-actions">
        <button onClick={() => setReplying((v) => !v)}>{replying ? 'Cancel' : 'Reply'}</button>
        <label className="comment-assign-toggle">
          <input
            type="checkbox"
            checked={thread.assigned_to_agent}
            onChange={(e) => void comments.toggleAssign(thread.id, e.target.checked)}
          />
          Assign to agent
        </label>
        {thread.status === 'open' ? (
          <button onClick={() => void comments.resolve(thread.id)}>Resolve</button>
        ) : (
          <button onClick={() => void comments.reopen(thread.id)}>Reopen</button>
        )}
      </div>

      {replying && (
        <CommentComposer
          submitLabel="Reply"
          placeholder="Reply…  @agent to ask the agent"
          suggestions={suggestions}
          onSubmit={async (body, tags) => { await comments.reply(thread.id, body, tags); setReplying(false) }}
        />
      )}
    </div>
  )
}

export function CommentsSidebar({ comments, collaborators, onFocusBlock }: Props) {
  const [tab, setTab] = useState<'open' | 'resolved'>('open')

  const suggestions = useMemo(
    () => [AGENT_SUGGESTION, ...collaborators.map((c) => ({ target_type: 'human' as const, target: c.name || c.id }))],
    [collaborators],
  )

  const shown = comments.threads.filter((t) => t.status === tab)

  if (!comments.open) return null

  return (
    <aside className="comments-sidebar">
      <header className="comments-header">
        <strong>Comments</strong>
        <button className="comments-close" onClick={() => comments.setOpen(false)} aria-label="Close comments">×</button>
      </header>

      {comments.draft && (
        <div className="comment-draft">
          <div className="comment-quote">“{comments.draft.quote}”</div>
          <CommentComposer
            submitLabel="Comment"
            placeholder="Comment on this block…  @agent to ask the agent"
            suggestions={suggestions}
            onSubmit={comments.submitDraft}
          />
          <button className="comment-draft-cancel" onClick={() => comments.setDraft(null)}>Cancel</button>
        </div>
      )}

      <div className="comments-tabs">
        <button className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>Open</button>
        <button className={tab === 'resolved' ? 'active' : ''} onClick={() => setTab('resolved')}>Resolved</button>
      </div>

      <div className="comments-list">
        {shown.length === 0 && <p className="comments-empty">No {tab} threads.</p>}
        {shown.map((t) => (
          <Thread key={t.id} thread={t} comments={comments} suggestions={suggestions} onFocusBlock={onFocusBlock} />
        ))}
      </div>
    </aside>
  )
}
