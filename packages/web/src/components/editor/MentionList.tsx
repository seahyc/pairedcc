interface Props {
  items: { id: string; label: string }[]
  command: (item: { id: string; label: string }) => void
  selectedIndex: number
}

export function MentionList({ items, command, selectedIndex }: Props) {
  return (
    <div className="mention-list">
      {items.map((item, i) => (
        <button
          key={item.id}
          className={`mention-item ${i === selectedIndex ? 'selected' : ''}`}
          onClick={() => command(item)}
        >
          @{item.label}
        </button>
      ))}
      {items.length === 0 && <div className="mention-item empty">No results</div>}
    </div>
  )
}
