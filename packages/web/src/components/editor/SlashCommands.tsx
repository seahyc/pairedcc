import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import tippy, { type Instance } from 'tippy.js'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

interface CommandItem {
  title: string
  description: string
  icon: string
  command: (props: { editor: any; range: any }) => void
}

const commands: CommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
    },
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    icon: '•',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    icon: '1.',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    title: 'Task List',
    description: 'Checklist with checkboxes',
    icon: '☑',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    title: 'Blockquote',
    description: 'Indented quote block',
    icon: '"',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    title: 'Code Block',
    description: 'Syntax-highlighted code',
    icon: '</>',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    title: 'Table',
    description: 'Insert a 3x3 table',
    icon: '⊞',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
  },
  {
    title: 'Horizontal Rule',
    description: 'Visual divider',
    icon: '—',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
  {
    title: 'Mermaid Diagram',
    description: 'Flowchart, sequence, or other diagram',
    icon: '◇',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: 'mermaidBlock',
        attrs: { content: 'graph TD\n  A[Start] --> B[End]' },
      }).run()
    },
  },
  {
    title: 'Math Block',
    description: 'LaTeX math equation',
    icon: '∑',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: 'mathBlock',
        attrs: { content: 'E = mc^2' },
      }).run()
    },
  },
  {
    title: 'Image',
    description: 'Embed an image from URL',
    icon: '🖼',
    command: ({ editor, range }) => {
      const url = window.prompt('Image URL')
      if (url) {
        editor.chain().focus().deleteRange(range).setImage({ src: url }).run()
      }
    },
  },
]

interface CommandListProps {
  items: CommandItem[]
  command: (item: CommandItem) => void
}

interface CommandListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => setSelectedIndex(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        if (items[selectedIndex]) command(items[selectedIndex])
        return true
      }
      return false
    },
  }))

  return (
    <div className="slash-menu">
      {items.map((item, index) => (
        <button
          key={item.title}
          className={`slash-menu-item ${index === selectedIndex ? 'is-selected' : ''}`}
          onClick={() => command(item)}
        >
          <span className="slash-menu-icon">{item.icon}</span>
          <div>
            <div className="slash-menu-title">{item.title}</div>
            <div className="slash-menu-desc">{item.description}</div>
          </div>
        </button>
      ))}
      {items.length === 0 && <div className="slash-menu-empty">No matching commands</div>}
    </div>
  )
})

export const slashCommandSuggestion = {
  items: ({ query }: { query: string }) => {
    return commands.filter(item =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.description.toLowerCase().includes(query.toLowerCase())
    )
  },
  render: () => {
    let component: ReactRenderer<CommandListRef>
    let popup: Instance[]

    return {
      onStart: (props: SuggestionProps) => {
        component = new ReactRenderer(CommandList, {
          props,
          editor: props.editor,
        })

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },

      onUpdate(props: SuggestionProps) {
        component.updateProps(props)
        popup[0]?.setProps({
          getReferenceClientRect: props.clientRect as () => DOMRect,
        })
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') {
          popup[0]?.hide()
          return true
        }
        return component.ref?.onKeyDown(props) ?? false
      },

      onExit() {
        popup[0]?.destroy()
        component.destroy()
      },
    }
  },
  char: '/',
  allowSpaces: false,
  startOfLine: true,
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return { suggestion: slashCommandSuggestion }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
