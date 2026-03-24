import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#4a9eff',
    primaryTextColor: '#eee',
    primaryBorderColor: '#555',
    lineColor: '#888',
    secondaryColor: '#1a1a2e',
    tertiaryColor: '#0d0d0d',
  },
})

let mermaidCounter = 0

function MermaidNodeView({ node, updateAttributes }: any) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [editing, setEditing] = useState(!node.attrs.content || node.attrs.content === 'graph TD\n  A[Start] --> B[End]')
  const [code, setCode] = useState(node.attrs.content || 'graph TD\n  A[Start] --> B[End]')

  useEffect(() => {
    if (!code.trim()) return
    const id = `mermaid-${++mermaidCounter}`
    mermaid.render(id, code)
      .then(({ svg }) => {
        setSvg(svg)
        setError('')
      })
      .catch((err) => {
        setError(err.message || 'Invalid mermaid syntax')
        setSvg('')
      })
  }, [code])

  const save = () => {
    updateAttributes({ content: code })
    setEditing(false)
  }

  return (
    <NodeViewWrapper className="mermaid-block">
      {editing ? (
        <div className="mermaid-editor">
          <div className="mermaid-editor-header">
            <span>Mermaid Diagram</span>
            <button className="btn btn-small" onClick={save}>Done</button>
          </div>
          <textarea
            className="mermaid-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={6}
            spellCheck={false}
          />
          {error && <div className="mermaid-error">{error}</div>}
          {svg && <div className="mermaid-preview" dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>
      ) : (
        <div className="mermaid-display" onClick={() => setEditing(true)} title="Click to edit">
          {svg ? (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="mermaid-placeholder">Click to add mermaid diagram</div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      content: { default: 'graph TD\n  A[Start] --> B[End]' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView)
  },
})
