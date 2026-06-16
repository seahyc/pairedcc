import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { marked } from 'marked'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Mention from '@tiptap/extension-mention'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { SlashCommands, slashCommandSuggestion } from './SlashCommands'
import { MermaidBlock } from './MermaidBlock'
import { MathBlock } from './MathBlock'
import { PccBlock } from '../../blocks/PccBlockNode'
import { registerBuiltinRenderers } from '../../blocks/renderers'

registerBuiltinRenderers()

const lowlight = createLowlight(common)

// Heuristic: does this pasted plain text look like markdown worth converting?
// We want false positives to be rare — when in doubt, paste as plain text.
const MD_PATTERNS = [
  /^#{1,6}\s+\S/m,            // ATX heading
  /^\s*[-*+]\s+\S/m,           // bullet list
  /^\s*\d+\.\s+\S/m,           // ordered list
  /^\s*>\s+\S/m,               // blockquote
  /^```/m,                     // fenced code
  /^---+\s*$/m,                // horizontal rule
  /^\|.+\|.*\n\|[\s\-:|]+\|/m, // table (header + separator)
  /\*\*[^*\n]+\*\*/,           // bold
  /\[[^\]\n]+\]\([^)\n]+\)/,   // link
]
function looksLikeMarkdown(text: string): boolean {
  if (text.length < 3) return false
  return MD_PATTERNS.some(re => re.test(text))
}

const WELCOME_CONTENT = `<h1>paired.cc</h1>
<p><strong>The doc where any agent can join.</strong> This doc is live — anyone with the link can edit, including the AI agents you connect.</p>
<h2>Try it in 30 seconds</h2>
<ol>
<li>Type <strong>/</strong> to see the block kit — live chart, React mini-app, sandboxed SQL, scrollytelling, and more.</li>
<li>Open this link in another tab to see multiplayer editing (cursors, presence, CRDT).</li>
<li>Open <strong>Share → For agents</strong> to copy the agent-readable URL. Curl it from anywhere — the doc is just plain markdown.</li>
</ol>
<h2>For agent builders</h2>
<p>Any agent can read and write paired.cc docs via HTTP. No MCP required, no proprietary integration.</p>
<pre><code>npm install @pairedcc/sdk</code></pre>
<pre><code>import { PairedClient } from '@pairedcc/sdk'
const paired = new PairedClient({ baseUrl: 'https://paired.cc', apiKey: '...' })
await paired.blocks.upsert(docId, paired.blocks.chart({
  kind: 'line', x: 'month', y: 'revenue',
  data: [{ month: 'Jan', revenue: 12000 }],
}))</code></pre>
<p>Full protocol spec: <a href="https://github.com/seahyc/pairedcc/blob/main/docs/PROTOCOL.md">docs/PROTOCOL.md</a>. Block kit manifest: <a href="/api/block-kit" target="_blank">/api/block-kit</a>.</p>
<hr>
<p></p>`

interface Props {
  doc: Y.Doc
  provider: WebsocketProvider
  userName: string
  userColor: string
  isAnonymous?: boolean
  /**
   * Called when the user clicks the BubbleMenu "💬 Comment" button. Receives a
   * text snippet of the enclosing top-level block — used as BOTH the comment's
   * block_anchor (the `editByAnchor` contract: resolve-by-text, robust under
   * collab edits) and the displayed quote.
   */
  onComment?: (blockText: string) => void
}

/**
 * Text of the top-level block containing the current selection. We walk up to
 * the doc's direct child (the "block") and return its text content. This is the
 * same anchoring unit the agent edit API resolves against.
 */
function enclosingBlockText(editor: import('@tiptap/react').Editor): string {
  const { state } = editor
  const $from = state.selection.$from
  // depth 1 is the top-level block under the doc node.
  const blockNode = $from.depth >= 1 ? $from.node(1) : $from.parent
  const text = (blockNode?.textContent ?? '').trim()
  return text
}

export function TiptapEditor({ doc, provider, userName, userColor, isAnonymous, onComment }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false,
        codeBlock: false, // replaced by CodeBlockLowlight
      }),
      Collaboration.configure({ document: doc }),
      CollaborationCursor.configure({
        provider,
        user: { name: userName, color: userColor },
      }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          items: ({ query }: { query: string }) => {
            return [
              { id: 'claude', label: 'claude' },
            ].filter(item => item.label.toLowerCase().startsWith(query.toLowerCase()))
          },
          render: () => ({
            onStart: () => {},
            onUpdate: () => {},
            onExit: () => {},
            onKeyDown: () => false,
          }),
        },
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: 'Type / for commands, or just start writing...',
      }),
      Typography,
      SlashCommands.configure({
        suggestion: slashCommandSuggestion,
      }),
      MermaidBlock,
      MathBlock,
      PccBlock.configure({ doc }),
    ],
    editorProps: {
      handlePaste(view, event) {
        const cd = event.clipboardData
        if (!cd) return false
        // If the source provided HTML (e.g. another rich editor), let Tiptap handle it.
        if (cd.getData('text/html')) return false
        const text = cd.getData('text/plain')
        if (!text || !looksLikeMarkdown(text)) return false

        const html = marked.parse(text, { async: false, gfm: true, breaks: false }) as string
        const parsed = new DOMParser().parseFromString(html, 'text/html')
        const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(parsed.body, {
          preserveWhitespace: false,
        })
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
        event.preventDefault()
        return true
      },
    },
    onCreate({ editor }) {
      if (isAnonymous) {
        // Wait for Yjs sync before checking emptiness to avoid duplication
        const checkAndInsert = () => {
          if (editor.isEmpty) {
            editor.commands.setContent(WELCOME_CONTENT)
          }
        }
        // If provider is already synced, check now; otherwise wait for sync
        if (provider.synced) {
          checkAndInsert()
        } else {
          provider.once('synced', checkAndInsert)
        }
      }
    },
  })

  if (!editor) return null

  return (
    <>
      <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }} className="bubble-menu">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'is-active' : ''}
        >
          B
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'is-active' : ''}
        >
          I
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={editor.isActive('strike') ? 'is-active' : ''}
        >
          S
        </button>
        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={editor.isActive('code') ? 'is-active' : ''}
        >
          {'<>'}
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
        >
          H2
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}
        >
          H3
        </button>
        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={editor.isActive('blockquote') ? 'is-active' : ''}
        >
          &ldquo;
        </button>
        <button
          onClick={() => {
            const url = window.prompt('URL')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
          className={editor.isActive('link') ? 'is-active' : ''}
        >
          Link
        </button>
        {onComment && (
          <button
            className="bubble-comment"
            title="Comment on this block"
            onClick={() => {
              const text = enclosingBlockText(editor)
              if (text) onComment(text)
            }}
          >
            💬 Comment
          </button>
        )}
      </BubbleMenu>
      <EditorContent editor={editor} className="tiptap-editor" />
    </>
  )
}
