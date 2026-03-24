import { useEditor, EditorContent } from '@tiptap/react'
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
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'

interface Props {
  doc: Y.Doc
  provider: WebsocketProvider
  userName: string
  userColor: string
}

export function TiptapEditor({ doc, provider, userName, userColor }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
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
          render: () => {
            return {
              onStart: () => {},
              onUpdate: () => {},
              onExit: () => {},
              onKeyDown: () => false,
            }
          },
        },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Link.configure({ openOnClick: false }),
    ],
  })

  return <EditorContent editor={editor} className="tiptap-editor" />
}
