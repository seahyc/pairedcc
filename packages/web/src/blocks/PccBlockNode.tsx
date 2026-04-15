import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { useEffect, useState, useMemo } from 'react'
import * as Y from 'yjs'
import { generateAnchor, BLOCKS_MAP_KEY, readBlockSnapshot, upsertBlock } from './schema'
import { getRenderer } from './registry'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pccBlock: {
      /** Insert a new block at the current selection. Returns the anchor. */
      insertPccBlock: (opts: { type: string; props?: unknown; state?: Record<string, unknown> }) => ReturnType
    }
  }
}

/**
 * Tiptap node for a paired.cc ComponentBlock. The node carries only the
 * `anchor` in its attributes — the actual block data lives in the doc's
 * pccBlocks Y.Map (so state can be CRDT-live).
 *
 * Configure with the Y.Doc instance:
 *   PccBlock.configure({ doc: yDoc })
 *
 * (Tiptap's Collaboration extension doesn't expose its document in storage,
 * so we pass it explicitly. Both extensions reference the same Y.Doc.)
 */
export interface PccBlockOptions {
  doc: Y.Doc | null
}

export const PccBlock = Node.create<PccBlockOptions>({
  name: 'pccBlock',
  group: 'block',
  atom: true,           // single unit, cursor doesn't enter
  selectable: true,
  draggable: true,

  addOptions() {
    return { doc: null }
  },

  addAttributes() {
    return {
      anchor: {
        default: null,
        parseHTML: el => el.getAttribute('data-anchor'),
        renderHTML: attrs => attrs.anchor ? { 'data-anchor': attrs.anchor } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-pcc-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-pcc-block': '', class: 'pcc-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PccBlockView)
  },

  addCommands() {
    return {
      insertPccBlock: (opts) => ({ chain }) => {
        const anchor = generateAnchor()
        const doc = this.options.doc
        if (!doc) {
          // eslint-disable-next-line no-console
          console.warn('[pccBlock] No Y.Doc configured. Pass via PccBlock.configure({ doc }).')
          return false
        }
        upsertBlock(doc, anchor, {
          type: opts.type,
          props: opts.props ?? {},
          state: opts.state ?? {},
        })
        return chain().insertContent({ type: 'pccBlock', attrs: { anchor } }).run()
      },
    }
  },
})

interface NodeViewProps {
  node: { attrs: { anchor: string | null } }
  extension: { options: PccBlockOptions }
}

function PccBlockView({ node, extension }: NodeViewProps) {
  const anchor = node.attrs.anchor
  const doc = extension.options.doc

  if (!anchor || !doc) {
    return (
      <NodeViewWrapper className="pcc-block pcc-block--missing">
        <em style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          [Block has no anchor or doc unavailable]
        </em>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="pcc-block">
      <BlockBody doc={doc} anchor={anchor} />
    </NodeViewWrapper>
  )
}

/**
 * Reads the block snapshot from the doc and re-reads on any change to the
 * pccBlocks Map or the block's nested state Map. Picks the renderer from
 * the registry by type.
 */
function BlockBody({ doc, anchor }: { doc: Y.Doc; anchor: string }) {
  const snapshot = useBlockSnapshot(doc, anchor)

  if (!snapshot) {
    return (
      <div className="pcc-block-stub">
        <strong>Missing block</strong> <code>{anchor}</code>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          The block was deleted or hasn't synced yet.
        </p>
      </div>
    )
  }

  const Renderer = getRenderer(snapshot.type)
  if (!Renderer) {
    return (
      <div className="pcc-block-stub">
        <strong>Unknown block type:</strong> <code>{snapshot.type}</code> <code>{anchor}</code>
        <pre style={{ fontSize: 11, marginTop: 8, opacity: 0.7 }}>
          {JSON.stringify({ props: snapshot.props, state: snapshot.state }, null, 2)}
        </pre>
      </div>
    )
  }
  return (
    <Renderer
      doc={doc}
      anchor={anchor}
      type={snapshot.type}
      props={snapshot.props}
      state={snapshot.state}
    />
  )
}

/**
 * React hook: subscribe to a block's snapshot. Re-renders on any change to
 * the pccBlocks Map (block created/deleted) or to the block's nested state
 * Map (state mutated by another peer or by an agent).
 */
export function useBlockSnapshot(doc: Y.Doc, anchor: string) {
  const blocks = useMemo(() => doc.getMap(BLOCKS_MAP_KEY), [doc])
  const [snap, setSnap] = useState(() => readBlockSnapshot(doc, anchor))

  useEffect(() => {
    let stateMap: Y.Map<unknown> | null = null
    let stateObserver: (() => void) | null = null

    const refresh = () => {
      // Defer to escape any synchronous-during-render path.
      queueMicrotask(() => setSnap(readBlockSnapshot(doc, anchor)))
    }

    const wireStateObserver = () => {
      // Tear down previous observer.
      if (stateMap && stateObserver) stateMap.unobserve(stateObserver as any)
      stateMap = null
      stateObserver = null

      const entry = blocks.get(anchor) as Y.Map<unknown> | undefined
      if (!entry) return
      const newStateMap = entry.get('state') as Y.Map<unknown> | undefined
      if (!newStateMap) return
      stateMap = newStateMap
      stateObserver = refresh
      newStateMap.observe(stateObserver as any)
    }

    // Top-level: anything in the blocks map changing (this anchor created, deleted, or other anchors)
    const blocksObserver = (event: Y.YMapEvent<unknown>) => {
      if (event.keysChanged.has(anchor)) {
        wireStateObserver()
        refresh()
      }
    }
    blocks.observe(blocksObserver)
    wireStateObserver()
    refresh()

    return () => {
      blocks.unobserve(blocksObserver)
      if (stateMap && stateObserver) stateMap.unobserve(stateObserver as any)
    }
  }, [doc, anchor, blocks])

  return snap
}
