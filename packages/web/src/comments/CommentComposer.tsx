import { useRef, useState } from 'react'
import type { CommentTag } from './api'
import { parseTags, tagsAssignAgent } from './tags'

/**
 * A comment / reply composer with an @-mention autocomplete, mirroring the
 * inline-mention UX (MentionList): type `@`, pick a target, and it's inserted
 * into the body. Tagging the agent (@agent / @claude) routes the thread to the
 * agent inbox; the composer previews that so the human knows.
 *
 * `suggestions` is the pickable target list (the agent plus any known
 * collaborators). Free-form `@handle` typing is also honored — the server
 * parses tags from the body regardless.
 */
interface Suggestion {
  target_type: 'agent' | 'human'
  target: string
}

interface Props {
  placeholder?: string
  submitLabel: string
  suggestions: Suggestion[]
  onSubmit: (body: string, tags: CommentTag[]) => void | Promise<void>
}

export function CommentComposer({ placeholder, submitLabel, suggestions, onSubmit }: Props) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ from: number; query: string } | null>(null)
  const [selected, setSelected] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const filtered = menu
    ? suggestions.filter((s) => s.target.toLowerCase().startsWith(menu.query.toLowerCase()))
    : []

  const detectedTags = parseTags(body)
  const willAssignAgent = tagsAssignAgent(detectedTags)

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setBody(value)
    // Find an active "@word" token ending at the caret.
    const caret = e.target.selectionStart ?? value.length
    const upto = value.slice(0, caret)
    const m = upto.match(/(?:^|[^\w@])@([a-zA-Z0-9_.-]*)$/)
    if (m) {
      setMenu({ from: caret - m[1].length - 1, query: m[1] })
      setSelected(0)
    } else {
      setMenu(null)
    }
  }

  function pick(s: Suggestion) {
    if (!menu) return
    const before = body.slice(0, menu.from)
    const after = body.slice(menu.from + 1 + menu.query.length)
    const next = `${before}@${s.target} ${after}`
    setBody(next)
    setMenu(null)
    taRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => (i + 1) % filtered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => (i - 1 + filtered.length) % filtered.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(filtered[selected]); return }
      if (e.key === 'Escape') { setMenu(null); return }
    }
    // Cmd/Ctrl+Enter submits.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() }
  }

  async function submit() {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await onSubmit(text, detectedTags)
      setBody('')
      setMenu(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="comment-composer">
      <div className="comment-composer-input">
        <textarea
          ref={taRef}
          value={body}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder || 'Add a comment…  @agent to ask the agent'}
          rows={2}
        />
        {menu && filtered.length > 0 && (
          <div className="comment-mention-list">
            {filtered.map((s, i) => (
              <button
                key={`${s.target_type}:${s.target}`}
                className={`comment-mention-item ${i === selected ? 'selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(s) }}
              >
                @{s.target}{s.target_type === 'agent' ? ' (agent)' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="comment-composer-actions">
        {willAssignAgent && <span className="comment-agent-hint">Will notify the agent</span>}
        <button className="comment-submit" onClick={() => void submit()} disabled={busy || !body.trim()}>
          {busy ? '…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
