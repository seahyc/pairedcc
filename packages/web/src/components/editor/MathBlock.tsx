import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import katex from 'katex'

function MathNodeView({ node, updateAttributes }: any) {
  const [editing, setEditing] = useState(!node.attrs.content || node.attrs.content === 'E = mc^2')
  const [code, setCode] = useState(node.attrs.content || 'E = mc^2')
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!code.trim()) return
    try {
      const rendered = katex.renderToString(code, {
        displayMode: true,
        throwOnError: false,
      })
      setHtml(rendered)
      setError('')
    } catch (err: any) {
      setError(err.message || 'Invalid LaTeX')
      setHtml('')
    }
  }, [code])

  const save = () => {
    updateAttributes({ content: code })
    setEditing(false)
  }

  return (
    <NodeViewWrapper className="math-block">
      {editing ? (
        <div className="math-editor">
          <div className="math-editor-header">
            <span>LaTeX Math</span>
            <button className="btn btn-small" onClick={save}>Done</button>
          </div>
          <textarea
            className="math-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="E = mc^2"
          />
          {error && <div className="math-error">{error}</div>}
          {html && <div className="math-preview" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      ) : (
        <div className="math-display" onClick={() => setEditing(true)} title="Click to edit">
          {html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="math-placeholder">Click to add math equation</div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      content: { default: 'E = mc^2' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView)
  },
})
