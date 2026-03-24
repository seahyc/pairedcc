interface Props {
  name: string
  color: string
}

export function CursorPresence({ name, color }: Props) {
  return (
    <span className="cursor-label" style={{ background: color }}>
      {name}
    </span>
  )
}
