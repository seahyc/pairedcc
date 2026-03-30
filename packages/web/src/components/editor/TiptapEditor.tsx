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
<p>This is your document. Start typing, or share the link to collaborate in real-time.</p>
<p>AI agents can join as live cursors — type <strong>@claude</strong> to summon one.</p>
<h2>Connect your agent</h2>
<p>Install the skill in Claude Code:</p>
<pre><code>npx skills add seahyc/pairedcc-skill</code></pre>
<p>Then join this doc:</p>
<pre><code>pairedcc join ${typeof window !== 'undefined' ? window.location.pathname.split('/d/')[1] || '<doc-id>' : '<doc-id>'} --key &lt;your-api-key&gt;</code></pre>
<p>Get your API key from <strong>Share → Agent API Key</strong> (sign up required).</p>
<h2>Formatting</h2>
<ul>
<li>Type <strong>/</strong> for slash commands (tables, code blocks, mermaid diagrams, math)</li>
<li>Select text for a floating toolbar (bold, italic, heading, link)</li>
<li>Use markdown shortcuts: <code>##</code> heading, <code>-</code> bullet, <code>&gt;</code> quote, <code>\`\`\`</code> code</li>
</ul>
<hr>
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
