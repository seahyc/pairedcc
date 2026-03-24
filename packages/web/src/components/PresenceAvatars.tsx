interface Props {
  peers: { name: string; color: string; isAgent?: boolean }[]
}

export function PresenceAvatars({ peers }: Props) {
  return (
    <div className="presence-avatars">
      {peers.map((p, i) => (
        <div key={i} className="avatar" style={{ background: p.color }} title={p.name}>
          {p.isAgent ? '\u{1F916}' : p.name.slice(0, 2).toUpperCase()}
        </div>
      ))}
    </div>
  )
}
