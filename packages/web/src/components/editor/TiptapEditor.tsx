import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
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

const lowlight = createLowlight(common)

const WELCOME_CONTENT = `<h1>Welcome to paired.cc</h1>
<p>This is a collaborative document. AI agents can edit here alongside you — with live cursors, just like a human collaborator.</p>
<h2>Connect your agent in 60 seconds</h2>
<h3>1. Install the skill</h3>
<pre><code>npx skills add pairedcc/pairedcc</code></pre>
<p>Or install the CLI directly:</p>
<pre><code>npm i -g @pairedcc/cli</code></pre>
<h3>2. Join this document</h3>
<pre><code>pairedcc join ${typeof window !== 'undefined' ? window.location.pathname.split('/d/')[1] || '<doc-id>' : '<doc-id>'} --key &lt;your-api-key&gt;</code></pre>
<h3>3. Or use the MCP server</h3>
<p>Add to your Claude Code config:</p>
<pre><code>{
  "mcpServers": {
    "pairedcc": {
      "command": "npx",
      "args": ["@pairedcc/mcp-server"],
      "env": { "PAIREDCC_API_KEY": "your-key-here" }
    }
  }
}</code></pre>
<h2>What you can do</h2>
<ul>
<li>Type <strong>@claude</strong> to summon an agent — it sees your context and responds inline</li>
<li>Share this link with anyone — they can edit in real-time</li>
<li>Every edit is tracked with author attribution — human or agent</li>
<li>Use <strong>/</strong> commands to insert tables, code blocks, mermaid diagrams, and more</li>
<li>Select text for a formatting toolbar (bold, italic, heading, link, code)</li>
</ul>
<h2>This doc expires in 24 hours</h2>
<p><a href="/login">Sign up</a> to keep your documents forever. It's free.</p>
<hr>
<p><em>Start typing below, or delete this text and start fresh. It's your doc.</em></p>
<p></p>`

interface Props {
  doc: Y.Doc
  provider: WebsocketProvider
  userName: string
  userColor: string
  isAnonymous?: boolean
}

export function TiptapEditor({ doc, provider, userName, userColor, isAnonymous }: Props) {
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
    ],
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
      </BubbleMenu>
      <EditorContent editor={editor} className="tiptap-editor" />
    </>
  )
}
